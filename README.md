# agent-teleport

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-60%20passing-brightgreen)]()
[![GitHub release](https://img.shields.io/github/v/release/tornikegomareli/agent-teleport)](https://github.com/tornikegomareli/agent-teleport/releases)

Convert AI coding agent sessions between formats, switch between agents without losing conversation history

Currently supports: **OpenCode → Claude Code**

## Why?

When you switch between AI coding agents (OpenCode, Claude Code, Codex, etc.), all conversation history is lost. agent-teleport reads sessions from one agent's storage and writes them into another agent's format, so you can pick up right where you left off.

## Install

Requires [Bun](https://bun.sh) >= 1.0.

```bash
# Install globally
bun install -g agent-teleport

# Or run directly
bunx agent-teleport
```

### Standalone binary

```bash
git clone https://github.com/tornikegomareli/agent-teleport.git
cd agent-teleport
bun install
bun run build  # produces ./agent-teleport binary
```

## Usage

### List sessions

```bash
# List all OpenCode sessions
agent-teleport list

# Filter by project directory
agent-teleport list -d /path/to/project
```

Sessions are grouped by project directory. Main sessions show with `●`, subagent sessions are nested underneath with `└`.

### Convert sessions

```bash
# Interactive session picker
agent-teleport convert

# Convert a specific session
agent-teleport convert <session-id>

# Convert all sessions for a project
agent-teleport convert --all -d /path/to/project

# Preview without writing files
agent-teleport convert <session-id> --dry-run

# Read from OpenCode export JSON instead of DB
agent-teleport convert --from-json exported-session.json

# Custom database path
agent-teleport convert <session-id> --db /path/to/opencode.db
```

After converting, open Claude Code in the same project directory — the imported sessions will appear in your conversation history.

### Flags

| Flag | Description |
|---|---|
| `--from` | Source format (default: `opencode`) |
| `--to` | Target format (default: `claude-code`) |
| `--db` | Override OpenCode database path |
| `--from-json` | Read from OpenCode export JSON file |
| `--all` | Convert all sessions |
| `-d, --directory` | Filter by project directory |
| `--dry-run` | Print JSONL output without writing files |
| `-v, --verbose` | Show detailed conversion info |

## How it works

agent-teleport uses a pluggable reader/writer architecture with a common intermediate representation (IR):

```
Reader(source) → IR → Writer(target)
```

Adding support for a new agent only requires implementing a reader, a writer, or both — all existing conversions work automatically.

### What gets converted

- User messages and assistant responses
- Tool calls (Bash, Read, Write, Edit, Glob, Grep, etc.) with inputs and outputs
- Thinking/reasoning blocks with cryptographic signatures
- Multi-step assistant turns (split by step boundaries)
- Token usage metadata and model information

### Edge cases handled

- Pending/running tool calls → converted as error: `[Tool execution was interrupted]`
- Compaction parts → skipped (internal to OpenCode context management)
- Subtask/agent parts → included as text annotation
- File attachments → converted to text: `[Attached file: <filename>]`
- Error-only messages with no content → skipped

## Supported agents

| Agent | Reader | Writer |
|---|---|---|
| OpenCode | Yes | — |
| Claude Code | — | Yes |
| Codex | Planned | Planned |
| Cursor | Planned | Planned |
| Aider | Planned | Planned |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add readers/writers for new agents.

## License

[MIT](LICENSE)
