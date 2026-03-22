import type { IRSession, IRMessage, IRContentBlock } from "../ir/types"

/**
 * Rough token estimate: ~4 chars per token for English text.
 * Used to decide whether compaction is needed, not for billing.
 */
export function estimateTokens(messages: IRMessage[]): number {
  let chars = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "text") chars += block.text.length
      if (block.type === "thinking") chars += block.text.length
      if (block.type === "tool_use") chars += JSON.stringify(block.input).length + block.tool.length
      if (block.type === "tool_result") chars += block.output.length
    }
  }
  return Math.ceil(chars / 4)
}

/**
 * Generate a structured summary of an IR session's messages,
 * matching Claude Code's native compaction format.
 */
export function generateSummary(session: IRSession, summarizedMessages: IRMessage[]): string {
  const userMessages = collectUserMessages(summarizedMessages)
  const filesUsed = collectFiles(summarizedMessages)
  const toolUsage = collectToolUsage(summarizedMessages)
  const lastAssistantText = getLastAssistantText(summarizedMessages)

  const sections: string[] = []

  sections.push(`This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.`)
  sections.push(``)
  sections.push(`Summary:`)

  // 1. Primary Request and Intent
  sections.push(`1. Primary Request and Intent:`)
  sections.push(`   The session "${session.title}" took place in ${session.directory}.`)
  if (userMessages.length > 0) {
    sections.push(`   The user's initial request was: "${truncate(userMessages[0], 200)}"`)
  }
  sections.push(``)

  // 2. Key Technical Concepts
  sections.push(`2. Key Technical Concepts:`)
  sections.push(`   This conversation involved ${summarizedMessages.length} messages with ${toolUsage.totalCalls} tool calls.`)
  if (toolUsage.byTool.size > 0) {
    const toolList = Array.from(toolUsage.byTool.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} (${count}x)`)
      .join(", ")
    sections.push(`   Tools used: ${toolList}`)
  }
  sections.push(``)

  // 3. Files and Code Sections
  if (filesUsed.length > 0) {
    sections.push(`3. Files and Code Sections:`)
    const filesByAction = new Map<string, Set<string>>()
    for (const f of filesUsed) {
      const set = filesByAction.get(f.action) || new Set()
      set.add(f.path)
      filesByAction.set(f.action, set)
    }
    for (const [action, paths] of filesByAction) {
      sections.push(`   ${action}: ${Array.from(paths).join(", ")}`)
    }
    sections.push(``)
  }

  // 4. All User Messages
  sections.push(`4. All User Messages:`)
  for (let i = 0; i < userMessages.length; i++) {
    sections.push(`   - "${truncate(userMessages[i], 300)}"`)
  }
  sections.push(``)

  // 5. Current Work
  sections.push(`5. Current Work:`)
  if (lastAssistantText) {
    sections.push(`   The assistant's last response was: "${truncate(lastAssistantText, 300)}"`)
  } else {
    sections.push(`   The conversation was in progress.`)
  }
  sections.push(``)

  sections.push(`If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at the session file.`)
  sections.push(`Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`)

  return sections.join("\n")
}

function collectUserMessages(messages: IRMessage[]): string[] {
  const texts: string[] = []
  for (const msg of messages) {
    if (msg.role !== "user") continue
    for (const block of msg.content) {
      if (block.type === "text") {
        texts.push(block.text)
      }
    }
  }
  return texts
}

interface FileUsage {
  path: string
  action: string
}

function collectFiles(messages: IRMessage[]): FileUsage[] {
  const files: FileUsage[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type !== "tool_use") continue
      const path = (block.input.file_path || block.input.filePath) as string | undefined
      if (!path) continue

      const key = `${block.tool}:${path}`
      if (seen.has(key)) continue
      seen.add(key)

      const action = block.tool === "read" ? "Read" :
                     block.tool === "write" ? "Created/Written" :
                     block.tool === "edit" ? "Edited" : block.tool
      files.push({ path, action })
    }
  }
  return files
}

function collectToolUsage(messages: IRMessage[]): { totalCalls: number; byTool: Map<string, number> } {
  const byTool = new Map<string, number>()
  let totalCalls = 0

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type !== "tool_use") continue
      totalCalls++
      byTool.set(block.tool, (byTool.get(block.tool) || 0) + 1)
    }
  }

  return { totalCalls, byTool }
}

function getLastAssistantText(messages: IRMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue
    for (const block of messages[i].content) {
      if (block.type === "text") return block.text
    }
  }
  return undefined
}

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\n/g, " ").trim()
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen) + "..."
}
