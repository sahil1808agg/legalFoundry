import { NextRequest, NextResponse }              from 'next/server'
import { createClient }                           from '@/lib/supabase/server'
import { classifyQuery, buildChatResponse }       from '@/lib/openai/chat'
import { requireAuth }                            from '@/lib/security/authGuard'
import { checkRateLimit }                         from '@/lib/security/rateLimiter'
import { sanitizeForLLM }                         from '@/lib/security/promptInjectionGuard'
import { parseBody, chatBodySchema }              from '@/lib/security/inputValidator'
import { checkMessageLength, trimHistory }        from '@/lib/security/tokenLimiter'
import { verifyContractOwnership }                from '@/lib/security/chatSecurity'

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
  let session_id: string

  const { data: existingSession } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('contract_id', contract_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingSession) {
    session_id = existingSession.id
  } else {
    const { data: newSession, error: sessionError } = await supabase
      .from('chat_sessions')
      .insert({ contract_id, user_id: user.id })
      .select('id')
      .single()

    if (sessionError || !newSession) {
      console.error('chat_sessions insert error:', sessionError)
      return NextResponse.json({ error: 'Failed to create chat session' }, { status: 500 })
    }
    session_id = newSession.id
  }

  // ── Load history BEFORE saving user message ───────────────────────────────
  const { data: historyRows } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(200)

  const rawHistory = (historyRows ?? []) as { role: 'user' | 'assistant'; content: string }[]
  const history    = trimHistory(rawHistory)

  // ── Classify + save user message ─────────────────────────────────────────
  const queryType = classifyQuery(question.trim())

  await supabase.from('chat_messages').insert({
    session_id,
    user_id: user.id,
    role:    'user',
    content: question.trim(),
  })

  // ── Call GPT-4o ───────────────────────────────────────────────────────────
  let reply: string
  try {
    reply = await buildChatResponse(contractText, history, question.trim(), queryType)
  } catch (err) {
    console.error('Chat OpenAI error:', err)
    return NextResponse.json({ error: 'AI response failed — please try again' }, { status: 502 })
  }

  // ── Save assistant message ────────────────────────────────────────────────
  let assistantMessage: Record<string, unknown> | null = null

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

  if (!assistantMessage) {
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  return NextResponse.json({ session_id, message: assistantMessage })
}
