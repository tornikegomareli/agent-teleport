import type { Reader } from "../readers/base"

/**
 * If cwd has sessions in the DB, return cwd to auto-filter.
 * Otherwise return undefined to show all sessions.
 */
export async function resolveDirectory(
  reader: Reader,
  cwd?: string,
): Promise<string | undefined> {
  const dir = cwd || process.cwd()
  const sessions = await reader.listSessions(dir)
  if (sessions.length > 0) return dir
  return undefined
}
