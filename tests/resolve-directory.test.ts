import { describe, test, expect } from "bun:test"
import { resolveDirectory } from "../src/util/resolve-directory"
import type { Reader } from "../src/readers/base"
import type { IRSession } from "../src/ir/types"

function mockReader(sessionsMap: Record<string, IRSession[]>): Reader {
  return {
    name: "mock",
    async listSessions(directory?: string): Promise<IRSession[]> {
      if (directory && sessionsMap[directory]) {
        return sessionsMap[directory]
      }
      if (!directory) {
        return Object.values(sessionsMap).flat()
      }
      return []
    },
    async readSession(_id: string): Promise<IRSession> {
      throw new Error("not implemented")
    },
  }
}

function makeSession(id: string, directory: string): IRSession {
  return {
    id,
    directory,
    title: `Session ${id}`,
    createdAt: Date.now(),
    messages: [],
  }
}

describe("resolveDirectory", () => {
  test("returns cwd when sessions exist for that directory", async () => {
    const reader = mockReader({
      "/home/user/myproject": [makeSession("s1", "/home/user/myproject")],
    })

    const result = await resolveDirectory(reader, "/home/user/myproject")
    expect(result).toBe("/home/user/myproject")
  })

  test("returns undefined when no sessions exist for cwd", async () => {
    const reader = mockReader({
      "/home/user/other": [makeSession("s1", "/home/user/other")],
    })

    const result = await resolveDirectory(reader, "/home/user/empty-dir")
    expect(result).toBeUndefined()
  })

  test("returns undefined for empty database", async () => {
    const reader = mockReader({})

    const result = await resolveDirectory(reader, "/any/path")
    expect(result).toBeUndefined()
  })

  test("returns cwd when multiple sessions exist", async () => {
    const reader = mockReader({
      "/home/user/project": [
        makeSession("s1", "/home/user/project"),
        makeSession("s2", "/home/user/project"),
        makeSession("s3", "/home/user/project"),
      ],
    })

    const result = await resolveDirectory(reader, "/home/user/project")
    expect(result).toBe("/home/user/project")
  })

  test("falls back to process.cwd() when no cwd argument provided", async () => {
    const cwd = process.cwd()
    const reader = mockReader({
      [cwd]: [makeSession("s1", cwd)],
    })

    const result = await resolveDirectory(reader)
    expect(result).toBe(cwd)
  })

  test("returns undefined when process.cwd() has no sessions", async () => {
    const reader = mockReader({
      "/some/other/dir": [makeSession("s1", "/some/other/dir")],
    })

    const result = await resolveDirectory(reader)
    expect(result).toBeUndefined()
  })
})
