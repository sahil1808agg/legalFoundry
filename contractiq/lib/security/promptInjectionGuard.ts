import { NextResponse } from 'next/server'

// Patterns that indicate an attempt to override, leak, or hijack the system prompt.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|all|above|prior)\s+(instructions?|rules?|prompts?|commands?)/i,
  /override\s+(your\s+)?(rules?|instructions?|system\s+prompt)/i,
  /forget\s+(everything|all|previous|your)\s+(instructions?|rules?|training|above)/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|internal|prompt|rules?)/i,
  /print\s+(your\s+)?(instructions?|system\s+prompt|prompt|rules?)/i,
  /show\s+(me\s+)?(your\s+)?(system\s+prompt|instructions?|prompt|api\s+keys?|env)/i,
  /expose\s+(env(ironment)?\s+(var(iable)?s?)?|api\s+keys?|secrets?|credentials?)/i,
  /what\s+(are\s+)?(your\s+)?(instructions?|system\s+prompt|rules?|initial\s+prompt)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|another|an?\s+)/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(?!a\s+contract)/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /roleplay\s+as\s+/i,
  /jailbreak/i,
  /dan\s+mode/i,
  /developer\s+mode/i,
  /do\s+anything\s+now/i,
  /sudo\s+mode/i,
  /bypass\s+(your\s+)?(filter|restriction|limitation|safety|rule)/i,
  /disregard\s+(your\s+)?(previous|all|prior)?\s*(instructions?|rules?|prompt)/i,
  /new\s+instructions?:/i,
  /system\s+prompt\s*:/i,
  /<\s*system\s*>/i,
  /\[INST\]/i,
  /<<SYS>>/i,
]

type SanitizeOk      = { clean: true }
type SanitizeBlocked = { clean: false; response: NextResponse }

export function sanitizeForLLM(input: string): SanitizeOk | SanitizeBlocked {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return {
        clean:    false,
        response: NextResponse.json(
          { error: 'Your message contains content that cannot be processed.' },
          { status: 400 }
        ),
      }
    }
  }
  return { clean: true }
}
