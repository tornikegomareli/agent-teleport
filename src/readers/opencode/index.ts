import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "fs"
import type { Reader } from "../base"
import type { IRSession, IRMessage, IRContentBlock } from "../../ir/types"
import { getOpenCodeDbPath } from "../../util/paths"
import { mapOpenCodeTool } from "./tool-map"
import type {
  OpenCodeSessionRow,
  OpenCodeMessageRow,
  OpenCodePartRow,
  OpenCodeMessageInfo,
  OpenCodePartData,
  OpenCodeExportJson,
} from "./types"

export class OpenCodeReader implements Reader {
  name = "opencode"
  private dbPath: string

  constructor(dbPath?: string) {
    this.dbPath = dbPath || getOpenCodeDbPath()
  }

  async listSessions(directory?: string): Promise<IRSession[]> {
    const db = this.openDb()
    try {
      let rows: OpenCodeSessionRow[]
      if (directory) {
        rows = db
          .query("SELECT * FROM session WHERE directory = ? ORDER BY time_updated DESC")
          .all(directory) as OpenCodeSessionRow[]
      } else {
        rows = db
          .query("SELECT * FROM session ORDER BY time_updated DESC")
          .all() as OpenCodeSessionRow[]
      }
      return rows.map((row) => ({
        id: row.id,
        directory: row.directory,
        title: row.title,
        createdAt: row.time_created,
        parentId: row.parent_id || undefined,
        messages: [], // don't load messages for listing
      }))
    } finally {
      db.close()
    }
  }

  async readSession(sessionId: string): Promise<IRSession> {
    const db = this.openDb()
    try {
      return this.readSessionFromDb(db, sessionId)
    } finally {
      db.close()
    }
  }

  async readFromJson(filePath: string): Promise<IRSession> {
    const raw = readFileSync(filePath, "utf-8")
    const data: OpenCodeExportJson = JSON.parse(raw)
    return this.convertExportJson(data)
  }

  async readAllSessions(directory?: string): Promise<IRSession[]> {
    const db = this.openDb()
    try {
      let rows: OpenCodeSessionRow[]
      if (directory) {
        rows = db
          .query("SELECT * FROM session WHERE directory = ? ORDER BY time_updated DESC")
          .all(directory) as OpenCodeSessionRow[]
      } else {
        rows = db
          .query("SELECT * FROM session ORDER BY time_updated DESC")
          .all() as OpenCodeSessionRow[]
      }
      return rows.map((row) => this.readSessionFromDb(db, row.id))
    } finally {
      db.close()
    }
  }

  private openDb(): Database {
    if (!existsSync(this.dbPath)) {
      throw new Error(`OpenCode database not found at: ${this.dbPath}`)
    }
    return new Database(this.dbPath, { readonly: true })
  }

  private readSessionFromDb(db: Database, sessionId: string): IRSession {
    const sessionRow = db
      .query("SELECT * FROM session WHERE id = ?")
      .get(sessionId) as OpenCodeSessionRow | null

    if (!sessionRow) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const messageRows = db
      .query("SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC")
      .all(sessionId) as OpenCodeMessageRow[]

    const partRows = db
      .query("SELECT * FROM part WHERE session_id = ? ORDER BY message_id, id ASC")
      .all(sessionId) as OpenCodePartRow[]

    const partsByMessage = new Map<string, OpenCodePartData[]>()
    for (const row of partRows) {
      const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data
      const list = partsByMessage.get(row.message_id) || []
      list.push(data as OpenCodePartData)
      partsByMessage.set(row.message_id, list)
    }

    const irMessages: IRMessage[] = []
    for (const msgRow of messageRows) {
      const info = (typeof msgRow.data === "string" ? JSON.parse(msgRow.data) : msgRow.data) as OpenCodeMessageInfo
      const parts = partsByMessage.get(msgRow.id) || []

      const converted = this.convertMessage(msgRow.id, info, parts)
      irMessages.push(...converted)
    }

    return {
      id: sessionRow.id,
      directory: sessionRow.directory,
      title: sessionRow.title,
      createdAt: sessionRow.time_created,
      messages: irMessages,
    }
  }

  private convertExportJson(data: OpenCodeExportJson): IRSession {
    const irMessages: IRMessage[] = []

    for (const msg of data.messages) {
      const parts: OpenCodePartData[] = msg.parts.map((p) => {
        // Strip the extra id/sessionID/messageID fields to get just the part data
        const { id: _id, sessionID: _sid, messageID: _mid, ...partData } = p as any
        return partData as OpenCodePartData
      })
      const converted = this.convertMessage(msg.info.id, msg.info, parts)
      irMessages.push(...converted)
    }

    return {
      id: data.info.id,
      directory: data.info.directory,
      title: data.info.title,
      createdAt: data.info.time_created,
      messages: irMessages,
    }
  }

  /**
   * Convert a single OpenCode message (with parts) into one or more IR messages.
   * User messages → 1 IR message
   * Assistant messages → split by step boundaries, each step becomes:
   *   1 assistant IR message + 1 user IR message (with tool results)
   */
  private convertMessage(
    messageId: string,
    info: OpenCodeMessageInfo,
    parts: OpenCodePartData[],
  ): IRMessage[] {
    if (info.role === "user") {
      return this.convertUserMessage(messageId, info, parts)
    }
    return this.convertAssistantMessage(messageId, info, parts)
  }

  private convertUserMessage(
    messageId: string,
    info: OpenCodeMessageInfo & { role: "user" },
    parts: OpenCodePartData[],
  ): IRMessage[] {
    const content: IRContentBlock[] = []

    for (const part of parts) {
      if (part.type === "text" && !part.ignored) {
        content.push({ type: "text", text: part.text })
      }
      if (part.type === "file") {
        content.push({
          type: "text",
          text: `[Attached file: ${part.filename || "file"} (${part.mime})]`,
        })
      }
      if (part.type === "subtask") {
        content.push({
          type: "text",
          text: `[Subtask: ${part.description}]`,
        })
      }
      // Skip compaction, snapshot, patch, agent, retry parts
    }

    if (content.length === 0) return []

    return [
      {
        id: messageId,
        role: "user",
        createdAt: info.time.created,
        content,
      },
    ]
  }

  private convertAssistantMessage(
    messageId: string,
    info: OpenCodeMessageInfo & { role: "assistant" },
    parts: OpenCodePartData[],
  ): IRMessage[] {
    // Skip error-only messages with no useful content
    if (
      info.error &&
      !parts.some(
        (p) => p.type === "text" || p.type === "tool" || p.type === "reasoning",
      )
    ) {
      return []
    }

    // Split parts into steps based on step-start/step-finish boundaries
    const steps = this.splitIntoSteps(parts)
    const results: IRMessage[] = []
    let stepIndex = 0

    for (const step of steps) {
      const assistantContent: IRContentBlock[] = []
      const toolResults: IRContentBlock[] = []

      for (const part of step) {
        if (part.type === "reasoning") {
          const signature = part.metadata?.["anthropic"]
            ? (part.metadata["anthropic"] as { signature?: string }).signature
            : undefined
          assistantContent.push({
            type: "thinking",
            text: part.text,
            signature,
          })
        }

        if (part.type === "text" && !("ignored" in part && part.ignored)) {
          assistantContent.push({ type: "text", text: part.text })
        }

        if (part.type === "tool") {
          const mapped = mapOpenCodeTool(part.tool, part.state.input)
          assistantContent.push({
            type: "tool_use",
            callId: part.callID,
            tool: mapped.name,
            input: mapped.input,
          })

          // Generate tool result
          if (part.state.status === "completed") {
            toolResults.push({
              type: "tool_result",
              callId: part.callID,
              output: part.state.output,
              isError: false,
            })
          } else if (part.state.status === "error") {
            toolResults.push({
              type: "tool_result",
              callId: part.callID,
              output: part.state.error,
              isError: true,
            })
          } else {
            // pending or running
            toolResults.push({
              type: "tool_result",
              callId: part.callID,
              output: "[Tool execution was interrupted]",
              isError: true,
            })
          }
        }

        if (part.type === "subtask") {
          assistantContent.push({
            type: "text",
            text: `[Subtask: ${part.description}]`,
          })
        }
      }

      if (assistantContent.length === 0) continue

      // Emit assistant message
      results.push({
        id: `${messageId}-step-${stepIndex}`,
        role: "assistant",
        createdAt: info.time.created,
        content: assistantContent,
        tokens: {
          input: info.tokens.input,
          output: info.tokens.output,
          reasoning: info.tokens.reasoning,
        },
        model: info.modelID,
      })

      // Emit tool results as a user message (if any)
      if (toolResults.length > 0) {
        results.push({
          id: `${messageId}-step-${stepIndex}-results`,
          role: "user",
          createdAt: info.time.created,
          content: toolResults,
        })
      }

      stepIndex++
    }

    return results
  }

  /**
   * Split parts into steps based on step-start/step-finish boundaries.
   * If no step boundaries exist, treat all parts as a single step.
   */
  private splitIntoSteps(parts: OpenCodePartData[]): OpenCodePartData[][] {
    const steps: OpenCodePartData[][] = []
    let current: OpenCodePartData[] = []
    let inStep = false

    for (const part of parts) {
      if (part.type === "step-start") {
        // If we had content before a step-start, flush it
        if (current.length > 0) {
          steps.push(current)
          current = []
        }
        inStep = true
        continue
      }

      if (part.type === "step-finish") {
        if (current.length > 0) {
          steps.push(current)
          current = []
        }
        inStep = false
        continue
      }

      // Skip non-content parts
      if (
        part.type === "snapshot" ||
        part.type === "patch" ||
        part.type === "compaction" ||
        part.type === "retry" ||
        part.type === "agent"
      ) {
        continue
      }

      current.push(part)
    }

    // Flush remaining
    if (current.length > 0) {
      steps.push(current)
    }

    // If no steps were created, return empty
    return steps.length > 0 ? steps : []
  }
}
