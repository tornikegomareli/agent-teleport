import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import type { Writer } from "../base"
import type { IRSession, IRMessage, IRContentBlock } from "../../ir/types"
import { encodeClaudeProjectDir, getClaudeProjectsDir } from "../../util/paths"
import { generateUuid, generateSessionId } from "../../util/uuid"
import { mapToClaudeTool } from "./tool-map"
import type {
  ClaudeCodeUserContent,
  ClaudeCodeAssistantContent,
} from "./types"

const CLAUDE_CODE_VERSION = "2.1.0"

export class ClaudeCodeWriter implements Writer {
  name = "claude-code"

  async writeSession(session: IRSession, dryRun = false): Promise<string> {
    const sessionId = generateSessionId()
    const encodedDir = encodeClaudeProjectDir(session.directory)
    const projectDir = join(getClaudeProjectsDir(), encodedDir)
    const outputPath = join(projectDir, `${sessionId}.jsonl`)

    const lines = this.generateLines(session, sessionId)
    const output = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"

    if (dryRun) {
      process.stdout.write(output)
      return outputPath
    }

    mkdirSync(projectDir, { recursive: true })
    writeFileSync(outputPath, output)
    return outputPath
  }

  private generateLines(session: IRSession, sessionId: string): Record<string, unknown>[] {
    const lines: Record<string, unknown>[] = []
    let lastUuid: string | null = null

    for (const message of session.messages) {
      const uuid = generateUuid()
      const timestamp = new Date(message.createdAt).toISOString()

      if (message.role === "user") {
        const content = this.buildUserContent(message.content)
        if (content.length === 0) continue

        lines.push({
          type: "user",
          parentUuid: lastUuid,
          isSidechain: false,
          uuid,
          timestamp,
          sessionId,
          version: CLAUDE_CODE_VERSION,
          cwd: session.directory,
          userType: "external",
          message: {
            role: "user",
            content,
          },
        })
        lastUuid = uuid
      } else {
        const content = this.buildAssistantContent(message.content)
        if (content.length === 0) continue

        const hasToolUse = content.some((c) => c.type === "tool_use")

        lines.push({
          type: "assistant",
          parentUuid: lastUuid,
          isSidechain: false,
          uuid,
          timestamp,
          sessionId,
          version: CLAUDE_CODE_VERSION,
          cwd: session.directory,
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
        })
        lastUuid = uuid
      }
    }

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

    return lines
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
