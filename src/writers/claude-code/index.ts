import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import type { Writer } from "../base"
import type { IRSession, IRMessage, IRContentBlock } from "../../ir/types"
import { encodeClaudeProjectDir, getClaudeProjectsDir } from "../../util/paths"
import { generateUuid, generateSessionId } from "../../util/uuid"
import { estimateTokens, generateSummary } from "../../util/summarize"
import { mapToClaudeTool } from "./tool-map"
import type {
  ClaudeCodeUserContent,
  ClaudeCodeAssistantContent,
} from "./types"

const CLAUDE_CODE_VERSION = "2.1.0"

// Claude Code compacts around 100-120K tokens. We use a conservative
// threshold to leave room for the system prompt and new messages.
const COMPACTION_TOKEN_THRESHOLD = 80_000


export class ClaudeCodeWriter implements Writer {
  name = "claude-code"

  async writeSession(session: IRSession, dryRun = false): Promise<string> {
    const sessionId = generateSessionId()
    const encodedDir = encodeClaudeProjectDir(session.directory)
    const projectDir = join(getClaudeProjectsDir(), encodedDir)
    const outputPath = join(projectDir, `${sessionId}.jsonl`)

    const lines = this.generateLines(session, sessionId, outputPath)
    const output = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"

    if (dryRun) {
      process.stdout.write(output)
      return outputPath
    }

    mkdirSync(projectDir, { recursive: true })
    writeFileSync(outputPath, output)
    return outputPath
  }

  private generateLines(
    session: IRSession,
    sessionId: string,
    outputPath: string,
  ): Record<string, unknown>[] {
    const totalTokens = estimateTokens(session.messages)
    const needsCompaction = totalTokens > COMPACTION_TOKEN_THRESHOLD

    if (needsCompaction) {
      return this.generateCompactedLines(session, sessionId, totalTokens)
    }

    return this.generateAllLines(session, sessionId)
  }

  /**
   * For sessions that exceed the token threshold:
   * 1. Insert a compact_boundary marker (no pre-boundary messages — Claude Code
   *    would try to process them all and hit API limits)
   * 2. Insert a summary user message with the condensed conversation
   * 3. Write the tail messages that Claude will actually see
   */
  private generateCompactedLines(
    session: IRSession,
    sessionId: string,
    preTokens: number,
  ): Record<string, unknown>[] {
    const lines: Record<string, unknown>[] = []

    const summaryUuid = generateUuid()
    const summaryText = generateSummary(session, session.messages)
    lines.push({
      parentUuid: null,
      isSidechain: false,
      uuid: summaryUuid,
      timestamp: new Date(session.createdAt).toISOString(),
      sessionId,
      version: CLAUDE_CODE_VERSION,
      cwd: session.directory,
      userType: "external",
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: summaryText }],
      },
    })

    const ackUuid = generateUuid()
    lines.push({
      type: "assistant",
      parentUuid: summaryUuid,
      isSidechain: false,
      uuid: ackUuid,
      timestamp: new Date(session.createdAt).toISOString(),
      sessionId,
      version: CLAUDE_CODE_VERSION,
      cwd: session.directory,
      userType: "external",
      requestId: `req_teleport_${ackUuid.slice(0, 12)}`,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "I have the full context from the previous conversation. Ready to continue." }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })

    this.addLastPrompt(lines, session, sessionId)

    return lines
  }

  private generateAllLines(session: IRSession, sessionId: string): Record<string, unknown>[] {
    const lines: Record<string, unknown>[] = []
    let lastUuid: string | null = null

    for (const message of session.messages) {
      const uuid = generateUuid()
      const timestamp = new Date(message.createdAt).toISOString()
      const line = this.buildMessageLine(message, uuid, lastUuid, sessionId, session.directory, timestamp)
      if (line) {
        lines.push(line)
        lastUuid = uuid
      }
    }

    this.addLastPrompt(lines, session, sessionId)
    return lines
  }

  private buildMessageLine(
    message: IRMessage,
    uuid: string,
    parentUuid: string | null,
    sessionId: string,
    cwd: string,
    timestamp: string,
  ): Record<string, unknown> | null {
    if (message.role === "user") {
      const content = this.buildUserContent(message.content)
      if (content.length === 0) return null

      return {
        type: "user",
        parentUuid,
        isSidechain: false,
        uuid,
        timestamp,
        sessionId,
        version: CLAUDE_CODE_VERSION,
        cwd,
        userType: "external",
        message: {
          role: "user",
          content,
        },
      }
    }

    const content = this.buildAssistantContent(message.content)
    if (content.length === 0) return null

    const hasToolUse = content.some((c) => c.type === "tool_use")

    return {
      type: "assistant",
      parentUuid,
      isSidechain: false,
      uuid,
      timestamp,
      sessionId,
      version: CLAUDE_CODE_VERSION,
      cwd,
      userType: "external",
      requestId: `req_teleport_${uuid.slice(0, 12)}`,
      message: {
        role: "assistant",
        model: message.model || "claude-sonnet-4-20250514",
        content,
        stop_reason: hasToolUse ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: message.tokens?.input || 0,
          output_tokens: message.tokens?.output || 0,
        },
      },
    }
  }

  private addLastPrompt(lines: Record<string, unknown>[], session: IRSession, sessionId: string) {
    const firstUserMessage = session.messages.find((m) => m.role === "user")
    const firstUserText = firstUserMessage?.content.find(
      (c): c is { type: "text"; text: string } => c.type === "text",
    )
    if (firstUserText) {
      lines.push({
        type: "last-prompt",
        lastPrompt: firstUserText.text,
        sessionId,
      })
    }
  }

  private buildUserContent(blocks: IRContentBlock[]): ClaudeCodeUserContent[] {
    const content: ClaudeCodeUserContent[] = []

    for (const block of blocks) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text })
      }
      if (block.type === "tool_result") {
        content.push({
          type: "tool_result",
          tool_use_id: block.callId,
          content: block.output,
          is_error: block.isError,
        })
      }
      if (block.type === "file") {
        content.push({
          type: "text",
          text: `[Attached file: ${block.filename} (${block.mime})]`,
        })
      }
    }

    return content
  }

  private buildAssistantContent(blocks: IRContentBlock[]): ClaudeCodeAssistantContent[] {
    const content: ClaudeCodeAssistantContent[] = []

    for (const block of blocks) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text })
      }
      if (block.type === "thinking") {
        content.push({
          type: "thinking",
          thinking: block.text,
          ...(block.signature ? { signature: block.signature } : {}),
        })
      }
      if (block.type === "tool_use") {
        const claudeToolName = mapToClaudeTool(block.tool)
        content.push({
          type: "tool_use",
          id: block.callId,
          name: claudeToolName,
          input: block.input,
        })
      }
    }

    return content
  }
}
