import { describe, test, expect } from "bun:test"
import { ClaudeCodeWriter } from "../src/writers/claude-code"
import type { IRSession, IRMessage } from "../src/ir/types"

function makeSession(messageCount: number, charsPerMessage: number): IRSession {
  const messages: IRMessage[] = []
  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? "user" : "assistant"
    messages.push({
      id: `msg-${i}`,
      role: role as "user" | "assistant",
      createdAt: 1700000000000 + i * 1000,
      content: [{ type: "text", text: `Message ${i}: ${"x".repeat(charsPerMessage)}` }],
      ...(role === "assistant" ? { model: "claude-opus-4-6" } : {}),
    })
  }
  return {
    id: "ses_compact",
    directory: "/tmp/test-compact",
    title: "Compaction test",
    createdAt: 1700000000000,
    messages,
  }
}

async function dryRunLines(writer: ClaudeCodeWriter, session: IRSession): Promise<any[]> {
  const chunks: string[] = []
  const origWrite = process.stdout.write
  process.stdout.write = (chunk: any) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }
  try {
    await writer.writeSession(session, true)
  } finally {
    process.stdout.write = origWrite
  }
  return chunks.join("").trim().split("\n").map((l) => JSON.parse(l))
}

describe("compaction", () => {
  test("small sessions are NOT compacted", async () => {
    // ~50 messages x 100 chars = ~1250 tokens, well under 80K threshold
    const session = makeSession(50, 100)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const boundary = lines.find((l) => l.subtype === "compact_boundary")
    expect(boundary).toBeUndefined()

    const summary = lines.find((l) => l.isCompactSummary === true)
    expect(summary).toBeUndefined()
  })

  test("large sessions ARE compacted", async () => {
    // 200 messages x 2000 chars = ~100K tokens, over 80K threshold
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const boundary = lines.find((l) => l.subtype === "compact_boundary")
    expect(boundary).toBeTruthy()
    expect(boundary.type).toBe("system")
    expect(boundary.content).toBe("Conversation compacted")
    expect(boundary.compactMetadata.trigger).toBe("auto")
    expect(boundary.compactMetadata.preTokens).toBeGreaterThan(80000)

    const summary = lines.find((l) => l.isCompactSummary === true)
    expect(summary).toBeTruthy()
    expect(summary.type).toBe("user")
    expect(summary.isVisibleInTranscriptOnly).toBe(true)
    expect(summary.message.content).toContain("This session is being continued")
  })

  test("compact_boundary has correct structure", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const boundary = lines.find((l) => l.subtype === "compact_boundary")

    expect(boundary.parentUuid).toBeNull()
    expect(boundary.logicalParentUuid).toBeTruthy()
    expect(boundary.isSidechain).toBe(false)
    expect(boundary.level).toBe("info")
    expect(boundary.isMeta).toBe(false)
    expect(boundary.uuid).toBeTruthy()
  })

  test("summary message chains from boundary", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const boundaryIdx = lines.findIndex((l) => l.subtype === "compact_boundary")
    const summary = lines[boundaryIdx + 1]

    expect(summary.isCompactSummary).toBe(true)
    expect(summary.parentUuid).toBe(lines[boundaryIdx].uuid)
  })

  test("messages after boundary chain from summary", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const summaryIdx = lines.findIndex((l) => l.isCompactSummary === true)
    const nextMsg = lines[summaryIdx + 1]

    // Next message should parent to summary
    expect(nextMsg.parentUuid).toBe(lines[summaryIdx].uuid)
  })

  test("tail messages are included after compaction", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const summaryIdx = lines.findIndex((l) => l.isCompactSummary === true)
    const afterSummary = lines.slice(summaryIdx + 1).filter(
      (l) => l.type === "user" || l.type === "assistant",
    )

    // Should have tail messages after summary
    expect(afterSummary.length).toBeGreaterThan(0)
    expect(afterSummary.length).toBeLessThanOrEqual(40)
  })

  test("parent chain is intact across compaction boundary", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    // Check all non-system lines have valid parent chains
    const uuids = new Set<string>()
    let broken = 0
    for (const line of lines) {
      if (line.uuid) uuids.add(line.uuid)
      // compact_boundary has parentUuid: null (by design)
      if (line.subtype === "compact_boundary") continue
      if (line.type === "last-prompt") continue
      if (line.parentUuid && !uuids.has(line.parentUuid)) broken++
    }
    expect(broken).toBe(0)
  })

  test("last-prompt is still included", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const lastPrompt = lines.find((l) => l.type === "last-prompt")
    expect(lastPrompt).toBeTruthy()
  })

  test("total line count includes pre-compaction + boundary + summary + tail + last-prompt", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const conversationMessages = lines.filter(
      (l) => (l.type === "user" || l.type === "assistant") && !l.isCompactSummary,
    ).length
    // All 200 original messages + boundary + summary + last-prompt = 203
    expect(conversationMessages).toBe(200)
    expect(lines.length).toBe(200 + 3) // boundary + summary + last-prompt
  })
})
