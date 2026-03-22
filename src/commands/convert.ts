import * as prompts from "@clack/prompts"
import type { Reader } from "../readers/base"
import type { Writer } from "../writers/base"
import { OpenCodeReader } from "../readers/opencode"
import type { IRSession } from "../ir/types"
import { estimateTokens } from "../util/summarize"

interface ConvertOptions {
  reader: Reader
  writer: Writer
  sessionId?: string
  all?: boolean
  fromJson?: string
  dryRun?: boolean
  verbose?: boolean
  directory?: string
}

export async function convertCommand(opts: ConvertOptions) {
  const { reader, writer, dryRun = false, verbose = false } = opts

  let sessions: IRSession[] = []

  if (opts.fromJson) {
    // Read from JSON export file
    if (!(reader instanceof OpenCodeReader)) {
      throw new Error("--from-json is only supported with the opencode reader")
    }
    const session = await reader.readFromJson(opts.fromJson)
    sessions = [session]
  } else if (opts.all) {
    // Convert all sessions
    if (reader instanceof OpenCodeReader) {
      sessions = await reader.readAllSessions(opts.directory)
    } else {
      const listed = await reader.listSessions(opts.directory)
      sessions = await Promise.all(listed.map((s) => reader.readSession(s.id)))
    }
  } else if (opts.sessionId) {
    // Convert specific session
    const session = await reader.readSession(opts.sessionId)
    sessions = [session]
  } else {
    // Interactive session picker
    const listed = await reader.listSessions(opts.directory)
    if (listed.length === 0) {
      console.log("No sessions found.")
      return
    }

    prompts.intro("Select session to convert")

    const selected = await prompts.select({
      message: "Choose a session:",
      options: listed.map((s) => ({
        label: s.title,
        value: s.id,
        hint: `${new Date(s.createdAt).toLocaleString()} • ...${s.id.slice(-8)}`,
      })),
    })

    if (prompts.isCancel(selected)) {
      prompts.cancel("Cancelled.")
      return
    }

    const session = await reader.readSession(selected as string)
    sessions = [session]
  }

  if (sessions.length === 0) {
    console.log("No sessions to convert.")
    return
  }

  let converted = 0
  for (const session of sessions) {
    if (verbose) {
      const tokens = estimateTokens(session.messages)
      console.log(`Converting: ${session.title} (${session.id})`)
      console.log(`  Messages: ${session.messages.length}, ~${Math.round(tokens / 1000)}K tokens`)
      if (tokens > 80_000) {
        console.log(`  Compacting: session exceeds token limit, generating summary`)
      }
    }

    const outputPath = await writer.writeSession(session, dryRun)
    converted++

    if (!dryRun) {
      console.log(`✓ ${session.title}`)
      console.log(`  → ${outputPath}`)
    }
  }

  if (!dryRun) {
    console.log(`\nConverted ${converted} session(s) from ${reader.name} → ${writer.name}`)
  }
}
