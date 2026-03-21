import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { ClaudeCodeWriter } from "../src/writers/claude-code"
import type { IRSession, IRMessage } from "../src/ir/types"
import { mkdirSync, readFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"

// We'll test generateLines logic via dry-run (stdout capture)
// and test real writes to a temp directory

function makeSession(overrides: Partial<IRSession> = {}): IRSession {
  return {
    id: "test-session-1",
    directory: "/tmp/test-project",
    title: "Test Session",
    createdAt: 1700000000000,
    messages: [],
    ...overrides,
  }
}

function makeUserMessage(text: string, id = "msg-u1"): IRMessage {
  return {
    id,
    role: "user",
    createdAt: 1700000000000,
    content: [{ type: "text", text }],
  }
}

function makeAssistantMessage(
  text: string,
  opts: { id?: string; model?: string; tokens?: IRMessage["tokens"] } = {},
): IRMessage {
  return {
    id: opts.id || "msg-a1",
    role: "assistant",
    createdAt: 1700000001000,
    content: [{ type: "text", text }],
    model: opts.model || "claude-opus-4-6",
    tokens: opts.tokens || { input: 100, output: 50, reasoning: 0 },
  }
}

describe("ClaudeCodeWriter", () => {
  describe("dry-run output structure", () => {
    test("generates valid JSONL with correct line types", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          makeUserMessage("Hello!"),
          makeAssistantMessage("Hi there!"),
        ],
      })

      // Capture stdout
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

      const output = chunks.join("")
      const lines = output.trim().split("\n")

      // user + assistant + last-prompt = 3 lines
      expect(lines).toHaveLength(3)

      const parsed = lines.map((l) => JSON.parse(l))
      expect(parsed[0].type).toBe("user")
      expect(parsed[1].type).toBe("assistant")
      expect(parsed[2].type).toBe("last-prompt")
    })

    test("each line is valid JSON", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          makeUserMessage("test"),
          makeAssistantMessage("response"),
        ],
      })

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

      const output = chunks.join("")
      for (const line of output.trim().split("\n")) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })
  })

  describe("parent UUID chaining", () => {
    test("first message has null parentUuid, subsequent messages chain", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          makeUserMessage("first", "u1"),
          makeAssistantMessage("second", { id: "a1" }),
          makeUserMessage("third", "u2"),
        ],
      })

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

      const lines = chunks.join("").trim().split("\n")
      const parsed = lines.filter((l) => {
        const j = JSON.parse(l)
        return j.type === "user" || j.type === "assistant"
      }).map((l) => JSON.parse(l))

      // First has null parent
      expect(parsed[0].parentUuid).toBeNull()

      // Each subsequent points to previous
      for (let i = 1; i < parsed.length; i++) {
        expect(parsed[i].parentUuid).toBe(parsed[i - 1].uuid)
      }

      // All UUIDs are unique
      const uuids = parsed.map((p: any) => p.uuid)
      expect(new Set(uuids).size).toBe(uuids.length)
    })
  })

  describe("user content blocks", () => {
    test("converts text blocks", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [makeUserMessage("Hello!")],
      })

      const lines = await dryRunLines(writer, session)
      const userLine = lines.find((l: any) => l.type === "user")

      expect(userLine.message.content).toEqual([{ type: "text", text: "Hello!" }])
    })

    test("converts tool_result blocks", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-tr",
            role: "user" as const,
            createdAt: 1700000000000,
            content: [
              {
                type: "tool_result" as const,
                callId: "call_xyz",
                output: "tool output here",
                isError: false,
              },
            ],
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const userLine = lines.find((l: any) => l.type === "user")

      expect(userLine.message.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "call_xyz",
        content: "tool output here",
        is_error: false,
      })
    })

    test("converts file blocks to text annotations", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-file",
            role: "user" as const,
            createdAt: 1700000000000,
            content: [
              {
                type: "file" as const,
                filename: "image.png",
                mime: "image/png",
                url: "data:image/png;base64,abc",
              },
            ],
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const userLine = lines.find((l: any) => l.type === "user")

      expect(userLine.message.content[0]).toEqual({
        type: "text",
        text: "[Attached file: image.png (image/png)]",
      })
    })
  })

  describe("assistant content blocks", () => {
    test("converts thinking blocks with signature", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-think",
            role: "assistant" as const,
            createdAt: 1700000000000,
            content: [
              {
                type: "thinking" as const,
                text: "Let me think...",
                signature: "sig_abc",
              },
              { type: "text" as const, text: "My answer" },
            ],
            model: "claude-opus-4-6",
            tokens: { input: 100, output: 50, reasoning: 20 },
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")

      expect(asstLine.message.content[0]).toEqual({
        type: "thinking",
        thinking: "Let me think...",
        signature: "sig_abc",
      })
      expect(asstLine.message.content[1]).toEqual({
        type: "text",
        text: "My answer",
      })
    })

    test("converts thinking blocks without signature", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-think-nosig",
            role: "assistant" as const,
            createdAt: 1700000000000,
            content: [
              { type: "thinking" as const, text: "hmm..." },
            ],
            model: "deepseek",
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")

      expect(asstLine.message.content[0]).toEqual({
        type: "thinking",
        thinking: "hmm...",
      })
      // no signature key at all
      expect(asstLine.message.content[0]).not.toHaveProperty("signature")
    })

    test("converts tool_use blocks with mapped names", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-tool",
            role: "assistant" as const,
            createdAt: 1700000000000,
            content: [
              {
                type: "tool_use" as const,
                callId: "call_1",
                tool: "bash",
                input: { command: "ls" },
              },
              {
                type: "tool_use" as const,
                callId: "call_2",
                tool: "read",
                input: { file_path: "/tmp/f" },
              },
              {
                type: "tool_use" as const,
                callId: "call_3",
                tool: "question",
                input: { text: "?" },
              },
            ],
            model: "claude-opus-4-6",
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")

      expect(asstLine.message.content[0].name).toBe("Bash")
      expect(asstLine.message.content[1].name).toBe("Read")
      expect(asstLine.message.content[2].name).toBe("AskHuman")
    })

    test("sets stop_reason to tool_use when tool blocks present", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-sr-tool",
            role: "assistant" as const,
            createdAt: 1700000000000,
            content: [
              { type: "tool_use" as const, callId: "c1", tool: "bash", input: { command: "ls" } },
            ],
            model: "claude-opus-4-6",
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")
      expect(asstLine.message.stop_reason).toBe("tool_use")
    })

    test("sets stop_reason to end_turn when no tool blocks", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [makeAssistantMessage("just text")],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")
      expect(asstLine.message.stop_reason).toBe("end_turn")
    })
  })

  describe("metadata fields", () => {
    test("includes sessionId, cwd, version, timestamp", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        directory: "/my/project",
        messages: [makeUserMessage("hi")],
      })

      const lines = await dryRunLines(writer, session)
      const userLine = lines.find((l: any) => l.type === "user")

      expect(userLine.cwd).toBe("/my/project")
      expect(userLine.version).toBe("2.1.0")
      expect(userLine.userType).toBe("external")
      expect(userLine.isSidechain).toBe(false)
      expect(userLine.sessionId).toBeTruthy()
      expect(userLine.timestamp).toBeTruthy()
    })

    test("assistant lines include model, usage, requestId", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          makeAssistantMessage("resp", {
            model: "claude-opus-4-6",
            tokens: { input: 300, output: 150, reasoning: 25 },
          }),
        ],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")

      expect(asstLine.message.model).toBe("claude-opus-4-6")
      expect(asstLine.message.usage.input_tokens).toBe(300)
      expect(asstLine.message.usage.output_tokens).toBe(150)
      expect(asstLine.requestId).toMatch(/^req_teleport_/)
    })

    test("defaults model to claude-sonnet when not specified", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "msg-no-model",
            role: "assistant" as const,
            createdAt: 1700000000000,
            content: [{ type: "text" as const, text: "hi" }],
            // no model field
          },
        ],
      })

      const lines = await dryRunLines(writer, session)
      const asstLine = lines.find((l: any) => l.type === "assistant")
      expect(asstLine.message.model).toBe("claude-sonnet-4-20250514")
    })
  })

  describe("last-prompt line", () => {
    test("captures first user message text as lastPrompt", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          makeUserMessage("What is this?"),
          makeAssistantMessage("It is a thing."),
          makeUserMessage("Tell me more"),
        ],
      })

      const lines = await dryRunLines(writer, session)
      const lastPrompt = lines.find((l: any) => l.type === "last-prompt")

      expect(lastPrompt).toBeTruthy()
      expect(lastPrompt.lastPrompt).toBe("What is this?")
    })

    test("omits last-prompt when no user messages", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [makeAssistantMessage("orphan response")],
      })

      const lines = await dryRunLines(writer, session)
      const lastPrompt = lines.find((l: any) => l.type === "last-prompt")
      expect(lastPrompt).toBeUndefined()
    })
  })

  describe("empty content filtering", () => {
    test("skips user messages with empty content", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          { id: "empty", role: "user" as const, createdAt: 1700000000000, content: [] },
          makeAssistantMessage("response"),
        ],
      })

      const lines = await dryRunLines(writer, session)
      const userLines = lines.filter((l: any) => l.type === "user")
      expect(userLines).toHaveLength(0)
    })

    test("skips assistant messages with only non-convertible blocks", async () => {
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        messages: [
          {
            id: "no-content",
            role: "assistant" as const,
            createdAt: 1700000000000,
            content: [
              // tool_result in assistant message won't produce any output
              { type: "tool_result" as const, callId: "c1", output: "x", isError: false },
            ],
          },
        ],
      })

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

      const output = chunks.join("").trim()
      // Should be empty or have no assistant lines
      if (output === "") {
        expect(output).toBe("")
      } else {
        const lines = output.split("\n").map((l) => JSON.parse(l))
        const asstLines = lines.filter((l: any) => l.type === "assistant")
        expect(asstLines).toHaveLength(0)
      }
    })
  })

  describe("real file write", () => {
    const testOutputDir = join(tmpdir(), `teleport-writer-test-${Date.now()}`)

    afterAll(() => {
      rmSync(testOutputDir, { recursive: true, force: true })
    })

    test("writes JSONL file to correct path", async () => {
      // We need to mock the paths to avoid writing to real ~/.claude
      // Instead we'll just verify the returned path format
      const writer = new ClaudeCodeWriter()
      const session = makeSession({
        directory: "/tmp/test-write-project",
        messages: [
          makeUserMessage("hello"),
          makeAssistantMessage("world"),
        ],
      })

      const outputPath = await writer.writeSession(session, false)

      // Verify path structure
      expect(outputPath).toContain(".claude/projects/")
      expect(outputPath).toContain("-tmp-test-write-project")
      expect(outputPath).toMatch(/\.jsonl$/)

      // Verify file was written and is valid JSONL
      const content = readFileSync(outputPath, "utf-8")
      const lines = content.trim().split("\n")
      expect(lines.length).toBeGreaterThanOrEqual(2)
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })
  })
})

// Helper to capture dry-run output and parse lines
async function dryRunLines(writer: ClaudeCodeWriter, session: IRSession): any[] {
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

  return chunks
    .join("")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
}
