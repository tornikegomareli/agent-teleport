import { describe, test, expect } from "bun:test"
import { mapToClaudeTool } from "../src/writers/claude-code/tool-map"

describe("mapToClaudeTool", () => {
  test("maps all known IR tool names to Claude Code PascalCase names", () => {
    expect(mapToClaudeTool("bash")).toBe("Bash")
    expect(mapToClaudeTool("read")).toBe("Read")
    expect(mapToClaudeTool("write")).toBe("Write")
    expect(mapToClaudeTool("edit")).toBe("Edit")
    expect(mapToClaudeTool("glob")).toBe("Glob")
    expect(mapToClaudeTool("grep")).toBe("Grep")
    expect(mapToClaudeTool("todowrite")).toBe("TodoWrite")
    expect(mapToClaudeTool("webfetch")).toBe("WebFetch")
    expect(mapToClaudeTool("websearch")).toBe("WebSearch")
  })

  test("maps question to AskHuman", () => {
    expect(mapToClaudeTool("question")).toBe("AskHuman")
  })

  test("is case-insensitive", () => {
    expect(mapToClaudeTool("BASH")).toBe("Bash")
    expect(mapToClaudeTool("Read")).toBe("Read")
    expect(mapToClaudeTool("WebSearch")).toBe("WebSearch")
  })

  test("PascalCases unmapped tool names", () => {
    expect(mapToClaudeTool("my-custom-tool")).toBe("MyCustomTool")
    expect(mapToClaudeTool("some_tool_name")).toBe("SomeToolName")
    expect(mapToClaudeTool("single")).toBe("Single")
  })

  test("handles already PascalCased unknown tools", () => {
    // "Agent" is not in the map, so it gets PascalCased — already is, so no change
    expect(mapToClaudeTool("Agent")).toBe("Agent")
  })
})
