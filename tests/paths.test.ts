import { describe, test, expect } from "bun:test"
import { encodeClaudeProjectDir } from "../src/util/paths"

describe("encodeClaudeProjectDir", () => {
  test("replaces slashes with hyphens", () => {
    expect(encodeClaudeProjectDir("/Users/tgomareli/Development/myproject")).toBe(
      "-Users-tgomareli-Development-myproject",
    )
  })

  test("replaces spaces and special characters", () => {
    expect(encodeClaudeProjectDir("/home/user/my project (v2)")).toBe(
      "-home-user-my-project--v2-",
    )
  })

  test("preserves alphanumeric characters", () => {
    expect(encodeClaudeProjectDir("abc123")).toBe("abc123")
  })

  test("replaces dots, tildes, colons", () => {
    expect(encodeClaudeProjectDir("/usr/local/bin/node.js")).toBe(
      "-usr-local-bin-node-js",
    )
    expect(encodeClaudeProjectDir("C:\\Users\\test")).toBe("C--Users-test")
  })

  test("handles empty string", () => {
    expect(encodeClaudeProjectDir("")).toBe("")
  })
})
