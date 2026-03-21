/**
 * Common Intermediate Representation (IR) for agent sessions.
 * All readers produce IR, all writers consume IR.
 */

export interface IRSession {
  id: string
  directory: string
  title: string
  createdAt: number // ms timestamp
  parentId?: string // parent session ID (for subagent sessions)
  messages: IRMessage[]
}

export interface IRMessage {
  id: string
  role: "user" | "assistant"
  createdAt: number
  content: IRContentBlock[]
  tokens?: { input: number; output: number; reasoning: number }
  model?: string
}

export type IRContentBlock =
  | IRTextBlock
  | IRThinkingBlock
  | IRToolUseBlock
  | IRToolResultBlock
  | IRFileBlock

export interface IRTextBlock {
  type: "text"
  text: string
}

export interface IRThinkingBlock {
  type: "thinking"
  text: string
  signature?: string
}

export interface IRToolUseBlock {
  type: "tool_use"
  callId: string
  tool: string
  input: Record<string, unknown>
}

export interface IRToolResultBlock {
  type: "tool_result"
  callId: string
  output: string
  isError: boolean
}

export interface IRFileBlock {
  type: "file"
  filename: string
  mime: string
  url: string
}
