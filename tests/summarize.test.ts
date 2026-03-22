import { describe, test, expect } from "bun:test"
import { estimateTokens, generateSummary } from "../src/util/summarize"
import type { IRSession, IRMessage } from "../src/ir/types"

function makeMsg(role: "user" | "assistant", text: string, id = "m1"): IRMessage {
  return {
    id,
    role,
    createdAt: Date.now(),
    content: [{ type: "text", text }],
  }
}

function makeToolMsg(tool: string, input: Record<string, unknown>, output: string): IRMessage[] {
  return [
    {
      id: "asst",
      role: "assistant",
      createdAt: Date.now(),
      content: [
        { type: "tool_use", callId: "c1", tool, input },
      ],
    },
    {
      id: "result",
      role: "user",
      createdAt: Date.now(),
      content: [
        { type: "tool_result", callId: "c1", output, isError: false },
      ],
    },
  ]
}

describe("estimateTokens", () => {
  test("estimates tokens from text blocks", () => {
    const msgs: IRMessage[] = [makeMsg("user", "Hello world")] // 11 chars ~3 tokens
    const tokens = estimateTokens(msgs)
    expect(tokens).toBe(3)
  })

  test("includes tool_use and tool_result content", () => {
    const msgs = makeToolMsg("bash", { command: "ls -la" }, "file1\nfile2\nfile3")
    const tokens = estimateTokens(msgs)
    expect(tokens).toBeGreaterThan(0)
  })

  test("includes thinking blocks", () => {
    const msgs: IRMessage[] = [{
      id: "m1",
      role: "assistant",
      createdAt: Date.now(),
      content: [{ type: "thinking", text: "Let me think about this carefully..." }],
    }]
    const tokens = estimateTokens(msgs)
    expect(tokens).toBeGreaterThan(0)
  })

  test("returns 0 for empty messages", () => {
    expect(estimateTokens([])).toBe(0)
  })

  test("scales roughly with content size", () => {
    const small = [makeMsg("user", "Hi")]
    const large = [makeMsg("user", "x".repeat(4000))]
    expect(estimateTokens(large)).toBeGreaterThan(estimateTokens(small) * 10)
  })
})

describe("generateSummary", () => {
  const session: IRSession = {
    id: "ses_1",
    directory: "/home/user/myproject",
    title: "Build auth system",
    createdAt: Date.now(),
    messages: [],
  }

  test("includes session title and directory", () => {
    const msgs: IRMessage[] = [makeMsg("user", "Build the auth")]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("Build auth system")
    expect(summary).toContain("/home/user/myproject")
  })

  test("includes the continuation preamble", () => {
    const msgs: IRMessage[] = [makeMsg("user", "Hello")]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("This session is being continued from a previous conversation")
  })

  test("includes all user messages", () => {
    const msgs: IRMessage[] = [
      makeMsg("user", "First request"),
      makeMsg("assistant", "Response 1"),
      makeMsg("user", "Second request"),
      makeMsg("assistant", "Response 2"),
      makeMsg("user", "Third request"),
    ]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("First request")
    expect(summary).toContain("Second request")
    expect(summary).toContain("Third request")
  })

  test("includes tool usage stats", () => {
    const msgs: IRMessage[] = [
      makeMsg("user", "Do stuff"),
      ...makeToolMsg("bash", { command: "ls" }, "files"),
      ...makeToolMsg("read", { file_path: "/tmp/f" }, "content"),
      ...makeToolMsg("bash", { command: "echo hi" }, "hi"),
    ]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("bash (2x)")
    expect(summary).toContain("read (1x)")
    expect(summary).toContain("3 tool calls")
  })

  test("includes files used by tools", () => {
    const msgs: IRMessage[] = [
      makeMsg("user", "Edit the file"),
      ...makeToolMsg("read", { file_path: "/src/auth.ts" }, "content"),
      ...makeToolMsg("edit", { file_path: "/src/auth.ts" }, "edited"),
      ...makeToolMsg("write", { file_path: "/src/new.ts" }, "created"),
    ]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("/src/auth.ts")
    expect(summary).toContain("/src/new.ts")
  })

  test("includes last assistant text as current work", () => {
    const msgs: IRMessage[] = [
      makeMsg("user", "Fix the bug"),
      makeMsg("assistant", "I found the issue in the login handler"),
    ]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("login handler")
  })

  test("includes resume instructions", () => {
    const msgs: IRMessage[] = [makeMsg("user", "Hello")]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("Continue the conversation from where it left off")
    expect(summary).toContain("do not acknowledge the summary")
  })

  test("truncates very long user messages", () => {
    const longText = "a".repeat(500)
    const msgs: IRMessage[] = [makeMsg("user", longText)]
    const summary = generateSummary(session, msgs)
    expect(summary).toContain("...")
    expect(summary.length).toBeLessThan(longText.length + 2000)
  })
})
