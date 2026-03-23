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
    const session = makeSession(50, 100)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    // All messages should be present
    const msgs = lines.filter((l) => l.type === "user" || l.type === "assistant")
    expect(msgs.length).toBe(50)
  })

  test("large sessions are compacted to summary + tail", async () => {
    // 200 messages x 2000 chars = ~100K tokens, over 80K threshold
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    // Should be much fewer lines than 200
    const msgs = lines.filter((l) => l.type === "user" || l.type === "assistant")
    expect(msgs.length).toBeLessThan(200)
    expect(msgs.length).toBeLessThanOrEqual(42) // ~40 tail + 1 summary
  })

  test("first line is the summary user message", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const first = lines[0]
    expect(first.type).toBe("user")
    expect(first.parentUuid).toBeNull()

    const content = first.message.content
    expect(Array.isArray(content)).toBe(true)
    expect(content[0].text).toContain("This session is being continued")
  })

  test("summary includes session context", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const summaryText = lines[0].message.content[0].text
    expect(summaryText).toContain("Compaction test")
    expect(summaryText).toContain("/tmp/test-compact")
    expect(summaryText).toContain("Continue the conversation")
  })

  test("tail messages chain from summary", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    // Second line should parent to the summary (first line)
    expect(lines[1].parentUuid).toBe(lines[0].uuid)
  })

  test("parent chain is intact through tail", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const uuids = new Set<string>()
    let broken = 0
    for (const line of lines) {
      if (line.uuid) uuids.add(line.uuid)
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

  test("output is summary + tail messages + last-prompt only", async () => {
    const session = makeSession(200, 2000)
    const writer = new ClaudeCodeWriter()
    const lines = await dryRunLines(writer, session)

    const msgs = lines.filter((l) => l.type === "user" || l.type === "assistant")
    const lastPrompts = lines.filter((l) => l.type === "last-prompt")

    // summary (1) + tail (<=40) + last-prompt (1)
    expect(msgs.length).toBeGreaterThan(1)
    expect(msgs.length).toBeLessThanOrEqual(42)
    expect(lastPrompts.length).toBe(1)
    expect(lines.length).toBe(msgs.length + 1) // msgs + last-prompt
  })
})
