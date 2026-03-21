# Contributing to agent-teleport

## Adding a New Agent Format

agent-teleport uses a pluggable reader/writer architecture. Converting between any two agents = `Reader(source) → IR → Writer(target)`. Adding support for a new agent only requires implementing one or both interfaces.

### Reader

Create a new directory under `src/readers/<agent-name>/` with:

- `index.ts` — implements the `Reader` interface from `src/readers/base.ts`
- `types.ts` — agent-specific types (storage schema, message formats)
- `tool-map.ts` — maps agent tool names/inputs to IR tool names/inputs

```typescript
import type { Reader } from "../base"
import type { IRSession } from "../../ir/types"

export class MyAgentReader implements Reader {
  name = "my-agent"

  async listSessions(directory?: string): Promise<IRSession[]> {
    // Read from agent's storage, return sessions without messages
  }

  async readSession(sessionId: string): Promise<IRSession> {
    // Read full session with all messages converted to IR format
  }
}
```

Then register it in `src/index.ts`:

```typescript
function getReader(name: string): Reader {
  switch (name) {
    case "my-agent":
      return new MyAgentReader()
    // ...
  }
}
```

### Writer

Create a new directory under `src/writers/<agent-name>/` with:

- `index.ts` — implements the `Writer` interface from `src/writers/base.ts`
- `types.ts` — agent-specific output types
- `tool-map.ts` — maps IR tool names to agent tool names

```typescript
import type { Writer } from "../base"
import type { IRSession } from "../../ir/types"

export class MyAgentWriter implements Writer {
  name = "my-agent"

  async writeSession(session: IRSession, dryRun?: boolean): Promise<string> {
    // Convert IR to agent's native format, write to disk, return output path
  }
}
```

### Intermediate Representation (IR)

The IR is defined in `src/ir/types.ts`. It captures the superset of all agents' capabilities:

- **IRSession** — id, directory, title, timestamp, messages
- **IRMessage** — role (user/assistant), ordered content blocks, optional token counts
- **IRContentBlock** — text, thinking (with optional signature), tool_use, tool_result, file

When converting, map your agent's concepts to these blocks. Key patterns:
- Tool calls and results must be separate messages (assistant has `tool_use`, next user has `tool_result`)
- Reasoning/thinking blocks should preserve cryptographic signatures when available
- Pending/interrupted tool calls should produce error results

### Running Tests

```bash
bun test
```

### Code Style

- No obvious comments — only comment non-obvious architecture decisions
- TypeScript strict mode
- Prefer explicit types at module boundaries, infer internally
