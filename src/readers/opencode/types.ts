/**
 * OpenCode-specific types derived from the OpenCode source.
 * These match the SQLite schema and message-v2.ts structures.
 */

export interface OpenCodeSessionRow {
  id: string
  project_id: string
  workspace_id: string | null
  parent_id: string | null
  slug: string
  directory: string
  title: string
  version: string
  share_url: string | null
  time_created: number
  time_updated: number
  time_compacting: number | null
  time_archived: number | null
}

export interface OpenCodeMessageRow {
  id: string
  session_id: string
  time_created: number
  time_updated: number
  data: string
}

export interface OpenCodePartRow {
  id: string
  message_id: string
  session_id: string
  time_created: number
  time_updated: number
  data: string
}

// Deserialized `data` column from message table
export interface OpenCodeUserInfo {
  role: "user"
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
}

export interface OpenCodeAssistantInfo {
  role: "assistant"
  time: { created: number; completed?: number }
  parentID: string
  modelID: string
  providerID: string
  agent: string
  path: { cwd: string; root: string }
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  error?: { name: string; [key: string]: unknown }
  summary?: boolean
  finish?: string
}

export type OpenCodeMessageInfo = OpenCodeUserInfo | OpenCodeAssistantInfo

// Deserialized `data` column from part table
export interface OpenCodeTextPart {
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  metadata?: Record<string, unknown>
}

export interface OpenCodeReasoningPart {
  type: "reasoning"
  text: string
  metadata?: Record<string, unknown>
  time: { start: number; end?: number }
}

export interface OpenCodeToolPart {
  type: "tool"
  callID: string
  tool: string
  state: OpenCodeToolState
  metadata?: Record<string, unknown>
}

export type OpenCodeToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata: Record<string, unknown>
      time: { start: number; end: number; compacted?: number }
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }

export interface OpenCodeStepStartPart {
  type: "step-start"
  snapshot?: string
}

export interface OpenCodeStepFinishPart {
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export interface OpenCodeFilePart {
  type: "file"
  mime: string
  filename?: string
  url: string
}

export interface OpenCodeCompactionPart {
  type: "compaction"
  auto: boolean
  overflow?: boolean
}

export interface OpenCodeSubtaskPart {
  type: "subtask"
  prompt: string
  description: string
  agent: string
}

export interface OpenCodeAgentPart {
  type: "agent"
  name: string
}

export interface OpenCodeSnapshotPart {
  type: "snapshot"
  snapshot: string
}

export interface OpenCodePatchPart {
  type: "patch"
  hash: string
  files: string[]
}

export interface OpenCodeRetryPart {
  type: "retry"
  attempt: number
}

export type OpenCodePartData =
  | OpenCodeTextPart
  | OpenCodeReasoningPart
  | OpenCodeToolPart
  | OpenCodeStepStartPart
  | OpenCodeStepFinishPart
  | OpenCodeFilePart
  | OpenCodeCompactionPart
  | OpenCodeSubtaskPart
  | OpenCodeAgentPart
  | OpenCodeSnapshotPart
  | OpenCodePatchPart
  | OpenCodeRetryPart

// Export JSON format (from opencode export command)
export interface OpenCodeExportJson {
  info: OpenCodeSessionRow & { [key: string]: unknown }
  messages: Array<{
    info: OpenCodeMessageInfo & { id: string; sessionID: string }
    parts: Array<OpenCodePartData & { id: string; sessionID: string; messageID: string }>
  }>
}
