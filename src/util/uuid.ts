import { randomUUID } from "crypto"

export function generateUuid(): string {
  return randomUUID()
}

export function generateSessionId(): string {
  return randomUUID()
}
