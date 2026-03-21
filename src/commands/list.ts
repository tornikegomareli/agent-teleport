import type { Reader } from "../readers/base"
import type { IRSession } from "../ir/types"

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function shortenDir(dir: string): string {
  const home = process.env.HOME || ""
  if (home && dir.startsWith(home)) {
    return "~" + dir.slice(home.length)
  }
  return dir
}

export async function listCommand(reader: Reader, directory?: string, verbose = false) {
  const sessions = await reader.listSessions(directory)

  if (sessions.length === 0) {
    console.log("No sessions found.")
    return
  }

  const mainSessions = sessions.filter((s) => !s.parentId)
  const subSessions = sessions.filter((s) => s.parentId)

  console.log(bold(`\n  ${sessions.length} sessions found`) + gray(` (${mainSessions.length} main, ${subSessions.length} subagent)\n`))

  const byDir = new Map<string, IRSession[]>()
  for (const s of sessions) {
    const list = byDir.get(s.directory) || []
    list.push(s)
    byDir.set(s.directory, list)
  }

  for (const [dir, dirSessions] of byDir) {
    console.log(`  ${yellow(shortenDir(dir))}`)

    const mains = dirSessions.filter((s) => !s.parentId)
    const subs = dirSessions.filter((s) => s.parentId)

    const subsByParent = new Map<string, IRSession[]>()
    for (const s of subs) {
      const list = subsByParent.get(s.parentId!) || []
      list.push(s)
      subsByParent.set(s.parentId!, list)
    }

    for (const session of mains) {
      const time = relativeTime(session.createdAt)
      console.log(`    ${green("●")} ${cyan(session.id)}  ${session.title}  ${gray(time)}`)

      const children = subsByParent.get(session.id) || []
      for (const child of children) {
        const childTime = relativeTime(child.createdAt)
        console.log(`      ${gray("└")} ${gray(child.id)}  ${dim(child.title)}  ${gray(childTime)}`)
      }
      subsByParent.delete(session.id)
    }

    for (const [, orphans] of subsByParent) {
      for (const child of orphans) {
        const childTime = relativeTime(child.createdAt)
        console.log(`      ${gray("└")} ${gray(child.id)}  ${dim(child.title)}  ${gray(childTime)}`)
      }
    }

    console.log()
  }

  console.log(dim(`  Usage: agent-teleport convert <id> --from opencode --to claude-code`))
  console.log()
}
