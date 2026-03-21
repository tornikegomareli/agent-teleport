#!/usr/bin/env bun
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { OpenCodeReader } from "./readers/opencode"
import { ClaudeCodeWriter } from "./writers/claude-code"
import { listCommand } from "./commands/list"
import { convertCommand } from "./commands/convert"
import type { Reader } from "./readers/base"
import type { Writer } from "./writers/base"

// Imported as a module so bun's bundler inlines it at compile time
import pkg from "../package.json"

function getReader(name: string, dbPath?: string): Reader {
  switch (name) {
    case "opencode":
      return new OpenCodeReader(dbPath)
    default:
      throw new Error(`Unknown reader: ${name}. Available: opencode`)
  }
}

function getWriter(name: string): Writer {
  switch (name) {
    case "claude-code":
      return new ClaudeCodeWriter()
    default:
      throw new Error(`Unknown writer: ${name}. Available: claude-code`)
  }
}

yargs(hideBin(process.argv))
  .scriptName("agent-teleport")
  .usage("$0 <command> [options]")
  .command(
    "list",
    "List available sessions",
    (yargs) =>
      yargs
        .option("from", {
          type: "string",
          default: "opencode",
          describe: "Source agent format",
        })
        .option("db", {
          type: "string",
          describe: "Override database path",
        })
        .option("directory", {
          alias: "d",
          type: "string",
          describe: "Filter by project directory",
        })
        .option("verbose", {
          alias: "v",
          type: "boolean",
          default: false,
          describe: "Show full session IDs",
        }),
    async (args) => {
      try {
        const reader = getReader(args.from, args.db)
        await listCommand(reader, args.directory, args.verbose)
      } catch (err: any) {
        console.error(`\x1b[31mError:\x1b[0m ${err.message}`)
        if (err.message.includes("database not found")) {
          console.error(`\nIs OpenCode installed? The database should be at the default path.`)
          console.error(`You can specify a custom path with: agent-teleport list --db /path/to/opencode.db`)
        }
        process.exit(1)
      }
    },
  )
  .command(
    "convert [sessionId]",
    "Convert sessions between agent formats",
    (yargs) =>
      yargs
        .positional("sessionId", {
          type: "string",
          describe: "Session ID to convert",
        })
        .option("from", {
          type: "string",
          default: "opencode",
          describe: "Source agent format",
        })
        .option("to", {
          type: "string",
          default: "claude-code",
          describe: "Target agent format",
        })
        .option("db", {
          type: "string",
          describe: "Override database path",
        })
        .option("from-json", {
          type: "string",
          describe: "Read from OpenCode export JSON file instead of DB",
        })
        .option("all", {
          type: "boolean",
          default: false,
          describe: "Convert all sessions",
        })
        .option("dry-run", {
          type: "boolean",
          default: false,
          describe: "Preview output without writing files",
        })
        .option("directory", {
          alias: "d",
          type: "string",
          describe: "Filter by project directory",
        })
        .option("verbose", {
          alias: "v",
          type: "boolean",
          default: false,
          describe: "Show detailed conversion info",
        }),
    async (args) => {
      try {
        const reader = getReader(args.from, args.db)
        const writer = getWriter(args.to)
        await convertCommand({
          reader,
          writer,
          sessionId: args.sessionId,
          all: args.all,
          fromJson: args.fromJson,
          dryRun: args.dryRun,
          verbose: args.verbose,
          directory: args.directory,
        })
      } catch (err: any) {
        console.error(`\x1b[31mError:\x1b[0m ${err.message}`)
        if (err.message.includes("Session not found")) {
          console.error(`\nRun \x1b[36magent-teleport list\x1b[0m to see available sessions.`)
        }
        if (err.message.includes("database not found")) {
          console.error(`\nIs OpenCode installed? You can specify a custom path with --db`)
        }
        process.exit(1)
      }
    },
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .version(pkg.version)
  .parse()
