/**
 * Claude Code JSONL line types.
 * Each line in a .jsonl session file is one of these.
 */

export interface ClaudeCodeUserLine {
  type: "user"
  parentUuid: string | null
  isSidechain: boolean
  uuid: string
  timestamp: string
  sessionId: string
  version: string
  cwd: string
  message: {
    role: "user"
    content: ClaudeCodeUserContent[]
  }
  userType: "external"
}

export interface ClaudeCodeAssistantLine {
  type: "assistant"
  parentUuid: string | null
  isSidechain: boolean
  uuid: string
  timestamp: string
  sessionId: string
  version: string
  cwd: string
  requestId: string
  message: {
    role: "assistant"
    model: string
    content: ClaudeCodeAssistantContent[]
    stop_reason: string | null
    usage: ClaudeCodeUsage
  }
  userType: "external"
}

export type ClaudeCodeUserContent =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }

export type ClaudeCodeAssistantContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }

export interface ClaudeCodeUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  service_tier?: string
}

export interface ClaudeCodeSummaryLine {
  type: "summary"
  sessionId: string
  summary: string
  leafUuid: string
  timestamp: string
}

export interface ClaudeCodeLastPromptLine {
  type: "last-prompt"
  lastPrompt: string
  sessionId: string
}
