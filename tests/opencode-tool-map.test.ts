import { describe, test, expect } from "bun:test"
import { mapOpenCodeTool } from "../src/readers/opencode/tool-map"

describe("mapOpenCodeTool", () => {
  test("maps known tools to lowercase IR names", () => {
    expect(mapOpenCodeTool("bash", { command: "ls" })).toEqual({
      name: "bash",
      input: { command: "ls" },
    })
    expect(mapOpenCodeTool("glob", { pattern: "*.ts" })).toEqual({
      name: "glob",
      input: { pattern: "*.ts" },
    })
    expect(mapOpenCodeTool("grep", { pattern: "foo", path: "/src" })).toEqual({
      name: "grep",
      input: { pattern: "foo", path: "/src" },
    })
    expect(mapOpenCodeTool("question", { text: "what?" })).toEqual({
      name: "question",
      input: { text: "what?" },
    })
  })

  test("renames filePath to file_path for read/write/edit", () => {
    const readResult = mapOpenCodeTool("read", { filePath: "/tmp/foo.ts" })
    expect(readResult).toEqual({
      name: "read",
      input: { file_path: "/tmp/foo.ts" },
    })
    expect(readResult.input).not.toHaveProperty("filePath")

    const writeResult = mapOpenCodeTool("write", {
      filePath: "/tmp/bar.ts",
      content: "hello",
    })
    expect(writeResult).toEqual({
      name: "write",
      input: { file_path: "/tmp/bar.ts", content: "hello" },
    })
    expect(writeResult.input).not.toHaveProperty("filePath")

    const editResult = mapOpenCodeTool("edit", {
      filePath: "/tmp/baz.ts",
      old_string: "a",
      new_string: "b",
    })
    expect(editResult).toEqual({
      name: "edit",
      input: { file_path: "/tmp/baz.ts", old_string: "a", new_string: "b" },
    })
    expect(editResult.input).not.toHaveProperty("filePath")
  })

  test("is case-insensitive for tool name lookup", () => {
    expect(mapOpenCodeTool("Bash", { command: "ls" }).name).toBe("bash")
    expect(mapOpenCodeTool("READ", { filePath: "/f" }).name).toBe("read")
    expect(mapOpenCodeTool("WebFetch", { url: "http://x" }).name).toBe("webfetch")
  })

  test("passes through unmapped tools unchanged", () => {
    expect(mapOpenCodeTool("myCustomTool", { x: 1 })).toEqual({
      name: "myCustomTool",
      input: { x: 1 },
    })
  })

  test("preserves extra input keys on mapped tools", () => {
    const result = mapOpenCodeTool("read", {
      filePath: "/tmp/f",
      offset: 10,
      limit: 100,
    })
    expect(result.input).toEqual({ file_path: "/tmp/f", offset: 10, limit: 100 })
  })

  test("handles empty input", () => {
    expect(mapOpenCodeTool("bash", {})).toEqual({ name: "bash", input: {} })
  })
})
