import { homedir } from "os"
import { join } from "path"

/**
 * Resolve the OpenCode database path based on platform.
 * macOS: Try XDG first (~/.local/share/opencode/opencode.db), then App Support
 * Linux: ~/.local/share/opencode/opencode.db
 * Windows: %APPDATA%\opencode\opencode.db
 */
export function getOpenCodeDbPath(): string {
  const home = homedir()
  const platform = process.platform

  if (platform === "darwin") {
    const xdg = join(home, ".local", "share", "opencode", "opencode.db")
    try {
      const fs = require("fs")
      if (fs.existsSync(xdg)) return xdg
    } catch {}
    return join(home, "Library", "Application Support", "opencode", "opencode.db")
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming")
    return join(appData, "opencode", "opencode.db")
  }

  return join(home, ".local", "share", "opencode", "opencode.db")
}

/**
 * Encode a directory path for Claude Code's project folder naming convention.
 * Replaces all non-alphanumeric characters with hyphens.
 */
export function encodeClaudeProjectDir(directory: string): string {
  return directory.replace(/[^a-zA-Z0-9]/g, "-")
}

export function getClaudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects")
}
