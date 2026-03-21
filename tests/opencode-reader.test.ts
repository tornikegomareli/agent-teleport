import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { OpenCodeReader } from "../src/readers/opencode"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * These tests create a temporary SQLite database that mimics
 * the OpenCode schema and verifies that the reader correctly
 * converts messages and parts into IR format.
 */

const TEST_DIR = join(tmpdir(), `teleport-test-${Date.now()}`)
const TEST_DB = join(TEST_DIR, "opencode.db")

function setupTestDb(): Database {
  mkdirSync(TEST_DIR, { recursive: true })
  const db = new Database(TEST_DB)

  // Create tables matching OpenCode schema
  db.run(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      time_created INTEGER NOT NULL DEFAULT 0,
      time_updated INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      workspace_id TEXT,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER NOT NULL DEFAULT 0,
      time_updated INTEGER NOT NULL DEFAULT 0,
      time_compacting INTEGER,
      time_archived INTEGER
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      time_created INTEGER NOT NULL DEFAULT 0,
      time_updated INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL DEFAULT 0,
      time_updated INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    )
  `)

  // Seed project
  db.run(`INSERT INTO project (id) VALUES ('proj_1')`)

  return db
}

let db: Database

beforeAll(() => {
  db = setupTestDb()
})

afterAll(() => {
  db.close()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

function insertSession(
  id: string,
  title: string,
  directory: string,
  timeCreated = 1700000000000,
) {
  db.run(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES (?, 'proj_1', ?, ?, ?, 'v1', ?, ?)`,
    [id, id, directory, title, timeCreated, timeCreated],
  )
}

function insertMessage(
  id: string,
  sessionId: string,
  data: object,
  timeCreated = 1700000000000,
) {
  db.run(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
    [id, sessionId, timeCreated, timeCreated, JSON.stringify(data)],
  )
}

function insertPart(
  id: string,
  messageId: string,
  sessionId: string,
  data: object,
  timeCreated = 1700000000000,
) {
  db.run(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, messageId, sessionId, timeCreated, timeCreated, JSON.stringify(data)],
  )
}

describe("OpenCodeReader", () => {
  describe("listSessions", () => {
    test("lists all sessions from DB", async () => {
      insertSession("ses_list_1", "First session", "/home/user/project1")
      insertSession("ses_list_2", "Second session", "/home/user/project2")

      const reader = new OpenCodeReader(TEST_DB)
      const sessions = await reader.listSessions()

      expect(sessions.length).toBeGreaterThanOrEqual(2)
      const ids = sessions.map((s) => s.id)
      expect(ids).toContain("ses_list_1")
      expect(ids).toContain("ses_list_2")
    })

    test("filters by directory", async () => {
      insertSession("ses_dir_1", "Dir session", "/specific/dir", 1700000001000)
      insertSession("ses_dir_2", "Other session", "/other/dir", 1700000002000)

      const reader = new OpenCodeReader(TEST_DB)
      const sessions = await reader.listSessions("/specific/dir")

      expect(sessions.every((s) => s.directory === "/specific/dir")).toBe(true)
      expect(sessions.some((s) => s.id === "ses_dir_1")).toBe(true)
    })

    test("returns empty messages array for listing", async () => {
      const reader = new OpenCodeReader(TEST_DB)
      const sessions = await reader.listSessions()
      for (const s of sessions) {
        expect(s.messages).toEqual([])
      }
    })
  })

  describe("readSession — user messages", () => {
    test("converts a simple user text message", async () => {
      insertSession("ses_user_1", "User test", "/tmp/test")
      insertMessage("msg_u1", "ses_user_1", {
        role: "user",
        time: { created: 1700000000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      })
      insertPart("part_u1", "msg_u1", "ses_user_1", {
        type: "text",
        text: "Hello, world!",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_user_1")

      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].role).toBe("user")
      expect(session.messages[0].content).toEqual([
        { type: "text", text: "Hello, world!" },
      ])
    })

    test("skips ignored text parts", async () => {
      insertSession("ses_ignored", "Ignored test", "/tmp/test")
      insertMessage("msg_ig", "ses_ignored", {
        role: "user",
        time: { created: 1700000000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      })
      insertPart("part_ig1", "msg_ig", "ses_ignored", {
        type: "text",
        text: "visible",
      })
      insertPart("part_ig2", "msg_ig", "ses_ignored", {
        type: "text",
        text: "hidden",
        ignored: true,
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_ignored")

      expect(session.messages[0].content).toHaveLength(1)
      expect(session.messages[0].content[0]).toEqual({
        type: "text",
        text: "visible",
      })
    })

    test("converts file parts to text annotations", async () => {
      insertSession("ses_file", "File test", "/tmp/test")
      insertMessage("msg_f1", "ses_file", {
        role: "user",
        time: { created: 1700000000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      })
      insertPart("part_f1", "msg_f1", "ses_file", {
        type: "file",
        mime: "image/png",
        filename: "screenshot.png",
        url: "data:image/png;base64,abc",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_file")

      expect(session.messages[0].content[0]).toEqual({
        type: "text",
        text: "[Attached file: screenshot.png (image/png)]",
      })
    })

    test("converts subtask parts in user messages", async () => {
      insertSession("ses_subtask_u", "Subtask user", "/tmp/test")
      insertMessage("msg_su", "ses_subtask_u", {
        role: "user",
        time: { created: 1700000000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      })
      insertPart("part_su", "msg_su", "ses_subtask_u", {
        type: "subtask",
        prompt: "do stuff",
        description: "Explore the codebase",
        agent: "explore",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_subtask_u")

      expect(session.messages[0].content[0]).toEqual({
        type: "text",
        text: "[Subtask: Explore the codebase]",
      })
    })

    test("skips user messages with only compaction/snapshot parts", async () => {
      insertSession("ses_empty_user", "Empty user", "/tmp/test")
      insertMessage("msg_eu", "ses_empty_user", {
        role: "user",
        time: { created: 1700000000000 },
        agent: "default",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      })
      insertPart("part_eu1", "msg_eu", "ses_empty_user", {
        type: "compaction",
        auto: true,
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_empty_user")

      expect(session.messages).toHaveLength(0)
    })
  })

  describe("readSession — assistant messages", () => {
    test("converts assistant text + tool call into assistant + tool_result pair", async () => {
      insertSession("ses_asst_1", "Assistant test", "/tmp/test")
      insertMessage("msg_a1", "ses_asst_1", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      insertPart("part_a1_text", "msg_a1", "ses_asst_1", {
        type: "text",
        text: "Let me read the file.",
      })
      insertPart("part_a1_tool", "msg_a1", "ses_asst_1", {
        type: "tool",
        callID: "call_123",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "/tmp/test/file.ts" },
          output: "file contents here",
          title: "Read file",
          metadata: {},
          time: { start: 1700000000000, end: 1700000001000 },
        },
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_asst_1")

      // Should produce 2 IR messages: assistant + user (tool results)
      expect(session.messages).toHaveLength(2)

      // Assistant message
      const asst = session.messages[0]
      expect(asst.role).toBe("assistant")
      expect(asst.content).toHaveLength(2)
      expect(asst.content[0]).toEqual({ type: "text", text: "Let me read the file." })
      expect(asst.content[1]).toEqual({
        type: "tool_use",
        callId: "call_123",
        tool: "read",
        input: { file_path: "/tmp/test/file.ts" }, // filePath → file_path
      })

      // Tool result message
      const result = session.messages[1]
      expect(result.role).toBe("user")
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: "tool_result",
        callId: "call_123",
        output: "file contents here",
        isError: false,
      })
    })

    test("handles error tool state", async () => {
      insertSession("ses_tool_err", "Tool error", "/tmp/test")
      insertMessage("msg_te", "ses_tool_err", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      insertPart("part_te", "msg_te", "ses_tool_err", {
        type: "tool",
        callID: "call_err",
        tool: "bash",
        state: {
          status: "error",
          input: { command: "bad_cmd" },
          error: "command not found: bad_cmd",
          time: { start: 1700000000000, end: 1700000001000 },
        },
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_tool_err")

      const toolResult = session.messages[1].content[0]
      expect(toolResult).toEqual({
        type: "tool_result",
        callId: "call_err",
        output: "command not found: bad_cmd",
        isError: true,
      })
    })

    test("handles pending/running tool state as interrupted", async () => {
      insertSession("ses_pending", "Pending tool", "/tmp/test")
      insertMessage("msg_pend", "ses_pending", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      insertPart("part_pend", "msg_pend", "ses_pending", {
        type: "tool",
        callID: "call_pending",
        tool: "bash",
        state: {
          status: "pending",
          input: { command: "sleep 100" },
          raw: '{"command":"sleep 100"}',
        },
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_pending")

      const toolResult = session.messages[1].content[0]
      expect(toolResult).toEqual({
        type: "tool_result",
        callId: "call_pending",
        output: "[Tool execution was interrupted]",
        isError: true,
      })
    })

    test("converts reasoning parts with Anthropic signature", async () => {
      insertSession("ses_reasoning", "Reasoning test", "/tmp/test")
      insertMessage("msg_r", "ses_reasoning", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 10, cache: { read: 0, write: 0 } },
      })
      insertPart("part_r1", "msg_r", "ses_reasoning", {
        type: "reasoning",
        text: "Let me think about this...",
        metadata: {
          anthropic: { signature: "sig_abc123" },
        },
        time: { start: 1700000000000, end: 1700000001000 },
      })
      insertPart("part_r2", "msg_r", "ses_reasoning", {
        type: "text",
        text: "Here is my answer.",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_reasoning")

      expect(session.messages[0].content[0]).toEqual({
        type: "thinking",
        text: "Let me think about this...",
        signature: "sig_abc123",
      })
      expect(session.messages[0].content[1]).toEqual({
        type: "text",
        text: "Here is my answer.",
      })
    })

    test("converts reasoning without signature (non-Anthropic model)", async () => {
      insertSession("ses_no_sig", "No sig", "/tmp/test")
      insertMessage("msg_ns", "ses_no_sig", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "deepseek-v3",
        providerID: "openai",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 10, cache: { read: 0, write: 0 } },
      })
      insertPart("part_ns", "msg_ns", "ses_no_sig", {
        type: "reasoning",
        text: "thinking...",
        metadata: {},
        time: { start: 1700000000000 },
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_no_sig")

      expect(session.messages[0].content[0]).toEqual({
        type: "thinking",
        text: "thinking...",
        signature: undefined,
      })
    })

    test("skips error-only assistant messages with no content parts", async () => {
      insertSession("ses_err_only", "Error only", "/tmp/test")
      insertMessage("msg_eo", "ses_err_only", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        error: { name: "APIError", message: "rate limited" },
      })
      // Only a step-start part, no text/tool/reasoning
      insertPart("part_eo", "msg_eo", "ses_err_only", {
        type: "step-start",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_err_only")

      expect(session.messages).toHaveLength(0)
    })
  })

  describe("readSession — step splitting", () => {
    test("splits multi-step assistant messages into separate IR messages", async () => {
      insertSession("ses_steps", "Steps test", "/tmp/test")
      insertMessage("msg_steps", "ses_steps", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0.02,
        tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      // Step 1: text + tool (IDs must sort lexicographically in correct order)
      insertPart("p_step_01_a_start", "msg_steps", "ses_steps", { type: "step-start" })
      insertPart("p_step_01_b_text", "msg_steps", "ses_steps", {
        type: "text",
        text: "Step 1 text",
      })
      insertPart("p_step_01_c_tool", "msg_steps", "ses_steps", {
        type: "tool",
        callID: "call_s1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo step1" },
          output: "step1",
          title: "bash",
          metadata: {},
          time: { start: 1700000000000, end: 1700000001000 },
        },
      })
      insertPart("p_step_01_d_finish", "msg_steps", "ses_steps", {
        type: "step-finish",
        reason: "tool_use",
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      // Step 2: text only
      insertPart("p_step_02_a_start", "msg_steps", "ses_steps", { type: "step-start" })
      insertPart("p_step_02_b_text", "msg_steps", "ses_steps", {
        type: "text",
        text: "Step 2 final answer",
      })
      insertPart("p_step_02_c_finish", "msg_steps", "ses_steps", {
        type: "step-finish",
        reason: "end_turn",
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_steps")

      // Step 1 → assistant (text + tool_use) + user (tool_result)
      // Step 2 → assistant (text only)
      expect(session.messages).toHaveLength(3)

      expect(session.messages[0].role).toBe("assistant")
      expect(session.messages[0].id).toBe("msg_steps-step-0")
      expect(session.messages[0].content).toHaveLength(2) // text + tool_use

      expect(session.messages[1].role).toBe("user")
      expect(session.messages[1].id).toBe("msg_steps-step-0-results")
      expect(session.messages[1].content[0]).toHaveProperty("type", "tool_result")

      expect(session.messages[2].role).toBe("assistant")
      expect(session.messages[2].id).toBe("msg_steps-step-1")
      expect(session.messages[2].content).toEqual([
        { type: "text", text: "Step 2 final answer" },
      ])
    })

    test("handles parts without step boundaries as single step", async () => {
      insertSession("ses_nostep", "No step", "/tmp/test")
      insertMessage("msg_nostep", "ses_nostep", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      insertPart("p_ns_t", "msg_nostep", "ses_nostep", {
        type: "text",
        text: "Just text, no steps",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_nostep")

      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].content).toEqual([
        { type: "text", text: "Just text, no steps" },
      ])
    })

    test("skips snapshot, patch, compaction, retry, agent parts", async () => {
      insertSession("ses_skip_parts", "Skip parts", "/tmp/test")
      insertMessage("msg_sp", "ses_skip_parts", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      insertPart("p_sp1", "msg_sp", "ses_skip_parts", {
        type: "snapshot",
        snapshot: "snap_123",
      })
      insertPart("p_sp2", "msg_sp", "ses_skip_parts", {
        type: "text",
        text: "actual content",
      })
      insertPart("p_sp3", "msg_sp", "ses_skip_parts", {
        type: "patch",
        hash: "abc",
        files: ["a.ts"],
      })
      insertPart("p_sp4", "msg_sp", "ses_skip_parts", {
        type: "compaction",
        auto: true,
      })
      insertPart("p_sp5", "msg_sp", "ses_skip_parts", {
        type: "retry",
        attempt: 1,
      })
      insertPart("p_sp6", "msg_sp", "ses_skip_parts", {
        type: "agent",
        name: "explore",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_skip_parts")

      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].content).toEqual([
        { type: "text", text: "actual content" },
      ])
    })
  })

  describe("readSession — multiple tool calls in one step", () => {
    test("handles multiple tool calls producing multiple tool_result blocks", async () => {
      insertSession("ses_multi_tool", "Multi tool", "/tmp/test")
      insertMessage("msg_mt", "ses_multi_tool", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      insertPart("p_mt1", "msg_mt", "ses_multi_tool", {
        type: "tool",
        callID: "call_a",
        tool: "glob",
        state: {
          status: "completed",
          input: { pattern: "*.ts" },
          output: "file1.ts\nfile2.ts",
          title: "glob",
          metadata: {},
          time: { start: 1700000000000, end: 1700000001000 },
        },
      })
      insertPart("p_mt2", "msg_mt", "ses_multi_tool", {
        type: "tool",
        callID: "call_b",
        tool: "grep",
        state: {
          status: "completed",
          input: { pattern: "import", path: "/src" },
          output: "file1.ts:1:import foo",
          title: "grep",
          metadata: {},
          time: { start: 1700000000000, end: 1700000001000 },
        },
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_multi_tool")

      // assistant message has 2 tool_use blocks
      const asst = session.messages[0]
      expect(asst.content.filter((c) => c.type === "tool_use")).toHaveLength(2)

      // user message has 2 tool_result blocks
      const results = session.messages[1]
      expect(results.content.filter((c) => c.type === "tool_result")).toHaveLength(2)
    })
  })

  describe("readSession — token/model metadata", () => {
    test("preserves token counts and model name", async () => {
      insertSession("ses_meta", "Meta test", "/tmp/test")
      insertMessage("msg_meta", "ses_meta", {
        role: "assistant",
        time: { created: 1700000000000 },
        parentID: "msg_prev",
        modelID: "claude-opus-4-6",
        providerID: "anthropic",
        agent: "default",
        mode: "",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0.05,
        tokens: { input: 500, output: 200, reasoning: 50, cache: { read: 100, write: 200 } },
      })
      insertPart("p_meta", "msg_meta", "ses_meta", {
        type: "text",
        text: "response",
      })

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readSession("ses_meta")

      expect(session.messages[0].model).toBe("claude-opus-4-6")
      expect(session.messages[0].tokens).toEqual({
        input: 500,
        output: 200,
        reasoning: 50,
      })
    })
  })

  describe("readFromJson", () => {
    test("reads from an export JSON file", async () => {
      const exportData = {
        info: {
          id: "ses_json_1",
          project_id: "proj_1",
          slug: "test",
          directory: "/tmp/json-test",
          title: "JSON export test",
          version: "v1",
          time_created: 1700000000000,
          time_updated: 1700000000000,
        },
        messages: [
          {
            info: {
              id: "msg_j1",
              sessionID: "ses_json_1",
              role: "user" as const,
              time: { created: 1700000000000 },
              agent: "default",
              model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
            },
            parts: [
              {
                id: "part_j1",
                sessionID: "ses_json_1",
                messageID: "msg_j1",
                type: "text" as const,
                text: "Hello from JSON",
              },
            ],
          },
          {
            info: {
              id: "msg_j2",
              sessionID: "ses_json_1",
              role: "assistant" as const,
              time: { created: 1700000001000 },
              parentID: "msg_j1",
              modelID: "claude-opus-4-6",
              providerID: "anthropic",
              agent: "default",
              mode: "",
              path: { cwd: "/tmp/json-test", root: "/tmp/json-test" },
              cost: 0,
              tokens: { input: 50, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
            },
            parts: [
              {
                id: "part_j2",
                sessionID: "ses_json_1",
                messageID: "msg_j2",
                type: "text" as const,
                text: "Hello back!",
              },
            ],
          },
        ],
      }

      const jsonPath = join(TEST_DIR, "export.json")
      writeFileSync(jsonPath, JSON.stringify(exportData))

      const reader = new OpenCodeReader(TEST_DB)
      const session = await reader.readFromJson(jsonPath)

      expect(session.id).toBe("ses_json_1")
      expect(session.title).toBe("JSON export test")
      expect(session.directory).toBe("/tmp/json-test")
      expect(session.messages).toHaveLength(2)
      expect(session.messages[0].role).toBe("user")
      expect(session.messages[0].content[0]).toEqual({
        type: "text",
        text: "Hello from JSON",
      })
      expect(session.messages[1].role).toBe("assistant")
      expect(session.messages[1].content[0]).toEqual({
        type: "text",
        text: "Hello back!",
      })
    })
  })

  describe("readSession — throws on missing session", () => {
    test("throws when session does not exist", async () => {
      const reader = new OpenCodeReader(TEST_DB)
      expect(reader.readSession("ses_nonexistent")).rejects.toThrow("Session not found")
    })
  })

  describe("constructor — throws on missing DB", () => {
    test("throws when DB file does not exist", async () => {
      const reader = new OpenCodeReader("/nonexistent/path/opencode.db")
      expect(reader.listSessions()).rejects.toThrow("OpenCode database not found")
    })
  })
})
