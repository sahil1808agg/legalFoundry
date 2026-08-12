import { NextResponse } from 'next/server'

// ─── Constants ────────────────────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES  = 10 * 1024 * 1024   // 10 MB
export const MAX_PAGE_COUNT       = 50
export const MAX_CONTRACT_TOKENS  = 80_000
export const MAX_WORD_COUNT_MIN   = 50                  // below this = scanned PDF
export const MAX_MESSAGE_LENGTH   = 5_000               // characters per chat message
export const MAX_CHAT_HISTORY     = parseInt(process.env.MAX_CHAT_HISTORY ?? '100', 10)

// ─── Validators ───────────────────────────────────────────────────────────────

type LimitOk      = { valid: true }
type LimitFail    = { valid: false; response: NextResponse }

export function checkMessageLength(message: string): LimitOk | LimitFail {
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      valid:    false,
      response: NextResponse.json(
        { error: `Message exceeds the ${MAX_MESSAGE_LENGTH.toLocaleString()}-character limit.` },
        { status: 400 }
      ),
    }
  }
  return { valid: true }
}

export function checkFileSizeBytes(sizeBytes: number): LimitOk | LimitFail {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      valid:    false,
      response: NextResponse.json(
        { error: 'File exceeds the 10 MB limit.' },
        { status: 400 }
      ),
    }
  }
  return { valid: true }
}

// Trim history to MAX_CHAT_HISTORY messages before passing to the model.
export function trimHistory<T>(history: T[]): T[] {
  return history.slice(-MAX_CHAT_HISTORY)
}
