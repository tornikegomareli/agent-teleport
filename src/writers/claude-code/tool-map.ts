/**
 * Maps IR tool names to Claude Code tool names.
 */

const IR_TO_CLAUDE: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  todowrite: "TodoWrite",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  question: "AskHuman",
}

// Unmapped tools are PascalCased.
export function mapToClaudeTool(irToolName: string): string {
  const key = irToolName.toLowerCase()
  if (IR_TO_CLAUDE[key]) return IR_TO_CLAUDE[key]

  return irToolName
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("")
}
