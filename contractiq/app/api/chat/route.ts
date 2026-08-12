export const runtime    = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse }         from 'next/server'
import { createClient }                      from '@/lib/supabase/server'
import { azureClient }                       from '@/lib/azure'
import { requireAuth }                       from '@/lib/security/authGuard'
import { checkRateLimit }                    from '@/lib/security/rateLimiter'
import { sanitizeForLLM }                    from '@/lib/security/promptInjectionGuard'
import { parseBody, chatBodySchema }         from '@/lib/security/inputValidator'
import { checkMessageLength, trimHistory }   from '@/lib/security/tokenLimiter'
import { verifyContractOwnership }           from '@/lib/security/chatSecurity'
import type { ContextType }                  from '@/types/chat'

// ─── Query classifier ─────────────────────────────────────────────────────────

type QueryType = ContextType

const HISTORY_SIGNALS = [
  'you said', 'you mentioned', 'you told me', 'you noted', 'you explained',
  'earlier you', 'earlier i', 'you previously', 'previously you',
  'what did you say', 'what did i ask', 'what did you tell',
  'last message', 'last response', 'last answer', 'last time',
  'we discussed', 'we talked about', 'we went over', 'our conversation',
  'in this chat', 'in this session', 'i asked you', 'i asked about',
  'you answered', 'you replied', 'your previous', 'your last',
  'remind me', 'what was', 'what were',
]

const CONTRACT_SIGNALS = [
  'contract', 'agreement', 'clause', 'section', 'provision', 'nda', 'msa',
  'document', 'terms', 'parties', 'governing law', 'jurisdiction',
  'termination', 'liability', 'indemnif', 'confidential', 'payment',
  'effective date', 'notice', 'ip ownership', 'intellectual property',
]

function classifyQuery(question: string): QueryType {
  const q = question.toLowerCase()
  const hasHistorySignal  = HISTORY_SIGNALS.some(k => q.includes(k))
  const hasContractSignal = CONTRACT_SIGNALS.some(k => q.includes(k))
  if (hasHistorySignal && hasContractSignal) return 'both'
  if (hasHistorySignal)                      return 'history'
  return 'contract'
}

function lastTurns(
  history: { role: 'user' | 'assistant'; content: string }[],
  turns: number,
): { role: 'user' | 'assistant'; content: string }[] {
  return history.slice(-(turns * 2))
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { user } = auth

  // ── Rate limit: 30 / minute ───────────────────────────────────────────────
  const rl = await checkRateLimit(user.id, 'chat')
  if (rl.limited) return rl.response

  // ── Validate body ─────────────────────────────────────────────────────────
  let rawBody: unknown
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseBody(chatBodySchema, rawBody)
  if (!parsed.success) return parsed.error
  const { contract_id, question } = parsed.data

  // ── Token / message length check ─────────────────────────────────────────
  const lenCheck = checkMessageLength(question)
  if (!lenCheck.valid) return lenCheck.response

  // ── Prompt injection guard ────────────────────────────────────────────────
  const sanitized = sanitizeForLLM(question)
  if (!sanitized.clean) return sanitized.response

  // ── Verify contract ownership + status ───────────────────────────────────
  const ownershipCheck = await verifyContractOwnership(contract_id, user.id)
  if (!ownershipCheck.ok) return ownershipCheck.response
  const { contractText } = ownershipCheck

  // ── Get or create chat session ────────────────────────────────────────────
  const supabase = createClient()
  let session_id: string | null = null

  try {
    const { data: existingSession } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('contract_id', contract_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingSession) {
      session_id = existingSession.id
    } else {
      const { data: newSession } = await supabase
        .from('chat_sessions')
        .insert({ contract_id, user_id: user.id })
        .select('id')
        .single()
      session_id = newSession?.id ?? null
    }
  } catch {
    // Continue without a session — null IDs are acceptable
  }

  // ── Load history ──────────────────────────────────────────────────────────
  let history: { role: 'user' | 'assistant'; content: string }[] = []

  if (session_id) {
    try {
      const { data: historyRows } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true })
        .limit(200)
      const rawHistory = (historyRows ?? []) as { role: 'user' | 'assistant'; content: string }[]
      history = trimHistory(rawHistory)
    } catch {
      // Proceed with empty history
    }
  }

  // ── Save user message ─────────────────────────────────────────────────────
  if (session_id) {
    try {
      await supabase.from('chat_messages').insert({
        session_id,
        user_id: user.id,
        role:    'user',
        content: question.trim(),
      })
    } catch {
      // Non-fatal
    }
  }

  // ── Build Azure agent input ───────────────────────────────────────────────
  const queryType = classifyQuery(question.trim())

  const parts: string[] = []

  if (queryType !== 'history') {
    parts.push(`CONTRACT TEXT:\n${contractText}`)
  }

  if (history.length > 0) {
    const turns = queryType === 'history' ? lastTurns(history, 20) : lastTurns(history, 10)
    const historyText = turns.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
    parts.push(`CONVERSATION HISTORY:\n${historyText}`)
  }

  parts.push(`USER QUESTION: ${question.trim()}`)

  const inputMessage = parts.join('\n\n---\n\n')

  // ── Call Azure agent ──────────────────────────────────────────────────────
  let reply: string
  try {
    const response = await (azureClient.responses as any).create({
      input: inputMessage,
    })
    reply =
      response.output_text ??
      response.output?.[0]?.content?.[0]?.text ??
      'No response generated.'
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('Azure agent error:', detail)
    return NextResponse.json({ error: detail }, { status: 502 })
  }

  // ── Save assistant message ────────────────────────────────────────────────
  let assistantMessage: Record<string, unknown> | null = null

  if (session_id) {
    try {
      const { data: msgWithType, error: insertError } = await supabase
        .from('chat_messages')
        .insert({ session_id, user_id: user.id, role: 'assistant', content: reply, context_type: queryType })
        .select('id, role, content, context_type, created_at, session_id, user_id')
        .single()

      if (insertError) {
        const { data: msgFallback } = await supabase
          .from('chat_messages')
          .insert({ session_id, user_id: user.id, role: 'assistant', content: reply })
          .select('id, role, content, created_at, session_id, user_id')
          .single()
        assistantMessage = msgFallback ? { ...msgFallback, context_type: null } : null
      } else {
        assistantMessage = msgWithType
      }
    } catch {
      // Non-fatal — return null message
    }
  }

  return NextResponse.json({ session_id, message: assistantMessage })
}
