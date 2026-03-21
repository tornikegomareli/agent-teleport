import type { IRSession } from "../ir/types"

export interface Reader {
  name: string
  listSessions(directory?: string): Promise<IRSession[]>
  readSession(sessionId: string): Promise<IRSession>
}
