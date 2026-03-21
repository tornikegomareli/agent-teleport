import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { OpenCodeReader } from "../src/readers/opencode"
import { ClaudeCodeWriter } from "../src/writers/claude-code"
import { mkdirSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * End-to-end tests: OpenCode DB → IR → Claude Code JSONL
 * Verifies the full pipeline with realistic multi-step conversations.
 */

const TEST_DIR = join(tmpdir(), `teleport-e2e-${Date.now()}`)
const TEST_DB = join(TEST_DIR, "opencode.db")

function setupDb(): Database {
  mkdirSync(TEST_DIR, { recursive: true })
  const db = new Database(TEST_DB)
  db.run(`CREATE TABLE project (id TEXT PRIMARY KEY, time_created INTEGER DEFAULT 0, time_updated INTEGER DEFAULT 0)`)
  db.run(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT,
      slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
      share_url TEXT, summary_additions INTEGER, summary_deletions INTEGER,
      summary_files INTEGER, summary_diffs TEXT, revert TEXT, permission TEXT,
      time_created INTEGER DEFAULT 0, time_updated INTEGER DEFAULT 0,
      time_compacting INTEGER, time_archived INTEGER
    )
  `)
  db.run(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER DEFAULT 0,
      time_updated INTEGER DEFAULT 0, data TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER DEFAULT 0, time_updated INTEGER DEFAULT 0, data TEXT NOT NULL
    )
  `)
  db.run(`INSERT INTO project (id) VALUES ('proj_1')`)
  return db
}

let db: Database

beforeAll(() => {
  db = setupDb()
})

afterAll(() => {
  db.close()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

function ins(table: string, obj: Record<string, any>) {
  const keys = Object.keys(obj)
  const vals = keys.map((k) => (typeof obj[k] === "object" ? JSON.stringify(obj[k]) : obj[k]))
  db.run(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    vals,
  )
}

describe("End-to-end: OpenCode → Claude Code", () => {
  test("full realistic conversation converts correctly", async () => {
    // Setup: a session with user prompt → assistant (thinking + text + 2 tool calls across 2 steps)
    ins("session", {
      id: "ses_e2e",
      project_id: "proj_1",
      slug: "e2e",
      directory: "/home/user/myapp",
      title: "E2E Test Session",
      version: "v1",
      time_created: 1700000000000,
      time_updated: 1700000010000,
    })

    // User message
    ins("message", {
      id: "msg_u",
      session_id: "ses_e2e",
      time_created: 1700000000000,
      time_updated: 1700000000000,
      data: {
        role: "user",
        time: { created: 1700000000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      },
    })
    ins("part", {
      id: "p_u1",
      message_id: "msg_u",
      session_id: "ses_e2e",
      time_created: 1700000000000,
      time_updated: 1700000000000,
      data: { type: "text", text: "Fix the bug in auth.ts" },
    })

    // Assistant message with 2 steps
    ins("message", {
      id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000001000,
      time_updated: 1700000005000,
      data: {
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000005000 },
        parentID: "msg_u",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/home/user/myapp", root: "/home/user/myapp" },
        cost: 0.03,
        tokens: { input: 1000, output: 500, reasoning: 100, cache: { read: 200, write: 300 } },
      },
    })

    // Step 1: thinking + read file (IDs must sort lexicographically in correct order)
    ins("part", {
      id: "p_e2e_1a_start",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000001000,
      time_updated: 1700000001000,
      data: { type: "step-start" },
    })
    ins("part", {
      id: "p_e2e_1b_reason",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000001100,
      time_updated: 1700000001100,
      data: {
        type: "reasoning",
        text: "I should read auth.ts first to understand the bug.",
        metadata: { anthropic: { signature: "sig_thinking_123" } },
        time: { start: 1700000001000, end: 1700000001100 },
      },
    })
    ins("part", {
      id: "p_e2e_1c_text",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000001200,
      time_updated: 1700000001200,
      data: { type: "text", text: "Let me read the auth file first." },
    })
    ins("part", {
      id: "p_e2e_1d_tool",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000001300,
      time_updated: 1700000002000,
      data: {
        type: "tool",
        callID: "call_read_auth",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "/home/user/myapp/src/auth.ts" },
          output: "export function login() {\n  // bug here\n}",
          title: "Read auth.ts",
          metadata: {},
          time: { start: 1700000001300, end: 1700000002000 },
        },
      },
    })
    ins("part", {
      id: "p_e2e_1e_finish",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000002000,
      time_updated: 1700000002000,
      data: {
        type: "step-finish",
        reason: "tool_use",
        cost: 0.015,
        tokens: { input: 500, output: 250, reasoning: 50, cache: { read: 100, write: 150 } },
      },
    })

    // Step 2: edit file
    ins("part", {
      id: "p_e2e_2a_start",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000003000,
      time_updated: 1700000003000,
      data: { type: "step-start" },
    })
    ins("part", {
      id: "p_e2e_2b_text",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000003100,
      time_updated: 1700000003100,
      data: { type: "text", text: "I found the bug. Let me fix it." },
    })
    ins("part", {
      id: "p_e2e_2c_tool",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000003200,
      time_updated: 1700000004000,
      data: {
        type: "tool",
        callID: "call_edit_auth",
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "/home/user/myapp/src/auth.ts", old_string: "// bug here", new_string: "// fixed" },
          output: "File edited successfully",
          title: "Edit auth.ts",
          metadata: {},
          time: { start: 1700000003200, end: 1700000004000 },
        },
      },
    })
    ins("part", {
      id: "p_e2e_2d_finish",
      message_id: "msg_a",
      session_id: "ses_e2e",
      time_created: 1700000004000,
      time_updated: 1700000004000,
      data: {
        type: "step-finish",
        reason: "end_turn",
        cost: 0.015,
        tokens: { input: 500, output: 250, reasoning: 50, cache: { read: 100, write: 150 } },
      },
    })

    // Run the pipeline
    const reader = new OpenCodeReader(TEST_DB)
    const irSession = await reader.readSession("ses_e2e")

    // Verify IR
    expect(irSession.id).toBe("ses_e2e")
    expect(irSession.directory).toBe("/home/user/myapp")
    expect(irSession.title).toBe("E2E Test Session")

    // Expected IR messages:
    // 1. user: "Fix the bug in auth.ts"
    // 2. assistant step 0: thinking + text + tool_use(read)
    // 3. user step 0 results: tool_result(read)
    // 4. assistant step 1: text + tool_use(edit)
    // 5. user step 1 results: tool_result(edit)
    expect(irSession.messages).toHaveLength(5)
    expect(irSession.messages[0].role).toBe("user")
    expect(irSession.messages[1].role).toBe("assistant")
    expect(irSession.messages[2].role).toBe("user")
    expect(irSession.messages[3].role).toBe("assistant")
    expect(irSession.messages[4].role).toBe("user")

    // Verify tool input mapping (filePath → file_path)
    const readToolUse = irSession.messages[1].content.find(
      (c) => c.type === "tool_use" && c.tool === "read",
    )
    expect(readToolUse).toBeTruthy()
    expect((readToolUse as any).input.file_path).toBe("/home/user/myapp/src/auth.ts")
    expect((readToolUse as any).input).not.toHaveProperty("filePath")

    // Write to Claude Code format
    const writer = new ClaudeCodeWriter()

    // Dry-run to capture output
    const chunks: string[] = []
    const origWrite = process.stdout.write
    process.stdout.write = (chunk: any) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
      return true
    }

    let outputPath: string
    try {
      outputPath = await writer.writeSession(irSession, true)
    } finally {
      process.stdout.write = origWrite
    }

    const jsonlOutput = chunks.join("")
    const jsonlLines = jsonlOutput.trim().split("\n").map((l) => JSON.parse(l))

    // Verify JSONL structure
    // 5 messages + 1 last-prompt = 6 lines
    expect(jsonlLines).toHaveLength(6)

    // Line 0: user message
    expect(jsonlLines[0].type).toBe("user")
    expect(jsonlLines[0].message.content[0].text).toBe("Fix the bug in auth.ts")
    expect(jsonlLines[0].parentUuid).toBeNull()

    // Line 1: assistant step 0 (thinking + text + tool_use)
    expect(jsonlLines[1].type).toBe("assistant")
    expect(jsonlLines[1].parentUuid).toBe(jsonlLines[0].uuid)
    const asstContent = jsonlLines[1].message.content
    expect(asstContent[0].type).toBe("thinking")
    expect(asstContent[0].thinking).toContain("read auth.ts")
    expect(asstContent[0].signature).toBe("sig_thinking_123")
    expect(asstContent[1].type).toBe("text")
    expect(asstContent[2].type).toBe("tool_use")
    expect(asstContent[2].name).toBe("Read") // mapped from "read"

    // Line 2: user tool results
    expect(jsonlLines[2].type).toBe("user")
    expect(jsonlLines[2].parentUuid).toBe(jsonlLines[1].uuid)
    expect(jsonlLines[2].message.content[0].type).toBe("tool_result")
    expect(jsonlLines[2].message.content[0].content).toContain("bug here")
    expect(jsonlLines[2].message.content[0].is_error).toBe(false)

    // Line 3: assistant step 1 (text + tool_use)
    expect(jsonlLines[3].type).toBe("assistant")
    expect(jsonlLines[3].parentUuid).toBe(jsonlLines[2].uuid)
    expect(jsonlLines[3].message.content[0].text).toContain("found the bug")
    expect(jsonlLines[3].message.content[1].type).toBe("tool_use")
    expect(jsonlLines[3].message.content[1].name).toBe("Edit")

    // Line 4: user tool results for edit
    expect(jsonlLines[4].type).toBe("user")
    expect(jsonlLines[4].message.content[0].type).toBe("tool_result")
    expect(jsonlLines[4].message.content[0].content).toBe("File edited successfully")

    // Line 5: last-prompt
    expect(jsonlLines[5].type).toBe("last-prompt")
    expect(jsonlLines[5].lastPrompt).toBe("Fix the bug in auth.ts")

    // Verify stop_reason
    expect(jsonlLines[1].message.stop_reason).toBe("tool_use")
    expect(jsonlLines[3].message.stop_reason).toBe("tool_use")

    // Verify all session IDs match
    const sessionIds = jsonlLines.filter((l: any) => l.sessionId).map((l: any) => l.sessionId)
    expect(new Set(sessionIds).size).toBe(1)

    // Verify path encoding in output
    expect(outputPath).toContain("-home-user-myapp")
  })

  test("session with only text (no tools) converts to minimal JSONL", async () => {
    ins("session", {
      id: "ses_text_only",
      project_id: "proj_1",
      slug: "text",
      directory: "/tmp/simple",
      title: "Simple chat",
      version: "v1",
      time_created: 1700010000000,
      time_updated: 1700010000000,
    })
    ins("message", {
      id: "msg_to_u",
      session_id: "ses_text_only",
      time_created: 1700010000000,
      time_updated: 1700010000000,
      data: {
        role: "user",
        time: { created: 1700010000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      },
    })
    ins("part", {
      id: "p_to_u",
      message_id: "msg_to_u",
      session_id: "ses_text_only",
      time_created: 1700010000000,
      time_updated: 1700010000000,
      data: { type: "text", text: "What is 2+2?" },
    })
    ins("message", {
      id: "msg_to_a",
      session_id: "ses_text_only",
      time_created: 1700010001000,
      time_updated: 1700010001000,
      data: {
        role: "assistant",
        time: { created: 1700010001000 },
        parentID: "msg_to_u",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/simple", root: "/tmp/simple" },
        cost: 0.001,
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    ins("part", {
      id: "p_to_a",
      message_id: "msg_to_a",
      session_id: "ses_text_only",
      time_created: 1700010001000,
      time_updated: 1700010001000,
      data: { type: "text", text: "2+2 = 4" },
    })

    const reader = new OpenCodeReader(TEST_DB)
    const session = await reader.readSession("ses_text_only")
    const writer = new ClaudeCodeWriter()

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

    const lines = chunks.join("").trim().split("\n").map((l) => JSON.parse(l))

    // user + assistant + last-prompt = 3
    expect(lines).toHaveLength(3)
    expect(lines[0].type).toBe("user")
    expect(lines[1].type).toBe("assistant")
    expect(lines[1].message.stop_reason).toBe("end_turn")
    expect(lines[2].type).toBe("last-prompt")
  })

  test("mixed tool states (completed, error, pending) all handled", async () => {
    ins("session", {
      id: "ses_mixed",
      project_id: "proj_1",
      slug: "mixed",
      directory: "/tmp/mixed",
      title: "Mixed states",
      version: "v1",
      time_created: 1700020000000,
      time_updated: 1700020000000,
    })
    ins("message", {
      id: "msg_mx_u",
      session_id: "ses_mixed",
      time_created: 1700020000000,
      time_updated: 1700020000000,
      data: {
        role: "user",
        time: { created: 1700020000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      },
    })
    ins("part", {
      id: "p_mx_u",
      message_id: "msg_mx_u",
      session_id: "ses_mixed",
      time_created: 1700020000000,
      time_updated: 1700020000000,
      data: { type: "text", text: "do stuff" },
    })

    ins("message", {
      id: "msg_mx_a",
      session_id: "ses_mixed",
      time_created: 1700020001000,
      time_updated: 1700020001000,
      data: {
        role: "assistant",
        time: { created: 1700020001000 },
        parentID: "msg_mx_u",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/mixed", root: "/tmp/mixed" },
        cost: 0,
        tokens: { input: 50, output: 30, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    // 3 tools: completed, error, running
    ins("part", {
      id: "p_mx_t1",
      message_id: "msg_mx_a",
      session_id: "ses_mixed",
      time_created: 1700020001100,
      time_updated: 1700020001100,
      data: {
        type: "tool",
        callID: "call_ok",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo ok" },
          output: "ok",
          title: "bash",
          metadata: {},
          time: { start: 1700020001100, end: 1700020001200 },
        },
      },
    })
    ins("part", {
      id: "p_mx_t2",
      message_id: "msg_mx_a",
      session_id: "ses_mixed",
      time_created: 1700020001200,
      time_updated: 1700020001200,
      data: {
        type: "tool",
        callID: "call_err",
        tool: "bash",
        state: {
          status: "error",
          input: { command: "false" },
          error: "exit code 1",
          time: { start: 1700020001200, end: 1700020001300 },
        },
      },
    })
    ins("part", {
      id: "p_mx_t3",
      message_id: "msg_mx_a",
      session_id: "ses_mixed",
      time_created: 1700020001300,
      time_updated: 1700020001300,
      data: {
        type: "tool",
        callID: "call_stuck",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "sleep 999" },
          time: { start: 1700020001300 },
        },
      },
    })

    const reader = new OpenCodeReader(TEST_DB)
    const session = await reader.readSession("ses_mixed")
    const writer = new ClaudeCodeWriter()

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

    const lines = chunks.join("").trim().split("\n").map((l) => JSON.parse(l))

    // Find the tool results user message
    const toolResultLine = lines.find(
      (l: any) => l.type === "user" && l.message.content.some((c: any) => c.type === "tool_result"),
    )
    expect(toolResultLine).toBeTruthy()

    const results = toolResultLine.message.content
    expect(results).toHaveLength(3)

    // completed
    expect(results[0].content).toBe("ok")
    expect(results[0].is_error).toBe(false)

    // error
    expect(results[1].content).toBe("exit code 1")
    expect(results[1].is_error).toBe(true)

    // running → interrupted
    expect(results[2].content).toBe("[Tool execution was interrupted]")
    expect(results[2].is_error).toBe(true)
  })
})
