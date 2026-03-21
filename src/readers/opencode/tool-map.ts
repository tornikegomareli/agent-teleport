/**
 * Maps OpenCode tool names to IR tool names and transforms input keys.
 */

interface ToolMapping {
  name: string
  mapInput: (input: Record<string, unknown>) => Record<string, unknown>
}

const identity = (input: Record<string, unknown>) => input

const TOOL_MAP: Record<string, ToolMapping> = {
  bash: { name: "bash", mapInput: identity },
  read: {
    name: "read",
    mapInput: (input) => {
      const mapped: Record<string, unknown> = { ...input }
      if ("filePath" in mapped) {
        mapped.file_path = mapped.filePath
        delete mapped.filePath
      }
      return mapped
    },
  },
  write: {
    name: "write",
    mapInput: (input) => {
      const mapped: Record<string, unknown> = { ...input }
      if ("filePath" in mapped) {
        mapped.file_path = mapped.filePath
        delete mapped.filePath
      }
      return mapped
    },
  },
  edit: {
    name: "edit",
    mapInput: (input) => {
      const mapped: Record<string, unknown> = { ...input }
      if ("filePath" in mapped) {
        mapped.file_path = mapped.filePath
        delete mapped.filePath
      }
      return mapped
    },
  },
  glob: { name: "glob", mapInput: identity },
  grep: { name: "grep", mapInput: identity },
  todowrite: { name: "todowrite", mapInput: identity },
  webfetch: { name: "webfetch", mapInput: identity },
  websearch: { name: "websearch", mapInput: identity },
  question: { name: "question", mapInput: identity },
}

export function mapOpenCodeTool(
  toolName: string,
  input: Record<string, unknown>,
): { name: string; input: Record<string, unknown> } {
  const key = toolName.toLowerCase()
  const mapping = TOOL_MAP[key]
  if (mapping) {
    return { name: mapping.name, input: mapping.mapInput(input) }
  }
  // Unmapped tools: keep original name
  return { name: toolName, input }
}
