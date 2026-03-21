import type { IRSession } from "../ir/types"

export interface Writer {
  name: string
  writeSession(session: IRSession, dryRun?: boolean): Promise<string>
}
