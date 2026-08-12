import { NextRequest, NextResponse }                                         from 'next/server'
import { createClient }                                                      from '@/lib/supabase/server'
import { buildExtractionPrompt, callExtractionWithRetry, ExtractedTerm }    from '@/lib/openai/extraction'
import { requireAuth }                                                        from '@/lib/security/authGuard'
import { checkRateLimit }                                                     from '@/lib/security/rateLimiter'
import { parseBody, processBodySchema }                                       from '@/lib/security/inputValidator'

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { user } = auth

  // ── Rate limit: 5 / hour ─────────────────────────────────────────────────
  const rl = await checkRateLimit(user.id, 'process')
  if (rl.limited) return rl.response

  // ── Validate body ─────────────────────────────────────────────────────────
  let rawBody: unknown
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseBody(processBodySchema, rawBody)
  if (!parsed.success) return parsed.error
  const { contract_id } = parsed.data

  // ── Fetch contract + verify ownership ────────────────────────────────────
  const supabase = createClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, contract_text, contract_type, status')
    .eq('id', contract_id)
    .eq('user_id', user.id)
    .single()

  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
  if (contract.status === 'completed') {
    return NextResponse.json({ error: 'Contract already processed' }, { status: 400 })
  }

  // ── Fetch custom terms ────────────────────────────────────────────────────
  const { data: customTermRows } = await supabase
    .from('custom_key_terms')
    .select('term_name')
    .eq('contract_id', contract_id)
    .order('created_at', { ascending: true })

  const customTerms = (customTermRows ?? []).map((r: { term_name: string }) => r.term_name)

  // ── Mark as processing ────────────────────────────────────────────────────
  await supabase
    .from('contracts')
    .update({ status: 'processing' })
    .eq('id', contract_id)

  // ── Build prompt + call OpenAI ────────────────────────────────────────────
  const { systemPrompt, userPrompt } = buildExtractionPrompt(
    contract.contract_type as 'nda' | 'msa',
    contract.contract_text,
    customTerms,
  )

  let extractedTerms: ExtractedTerm[]
  try {
    extractedTerms = await callExtractionWithRetry(systemPrompt, userPrompt)
  } catch (err) {
    console.error('Extraction failed:', err)
    await supabase.from('contracts').update({ status: 'error' }).eq('id', contract_id)
    const code = (err as { code?: number }).code
    return NextResponse.json(
      { error: 'AI extraction failed — please try again' },
      { status: code === 503 ? 503 : 502 }
    )
  }

  const customTermSet = new Set(customTerms.map(t => t.toLowerCase()))

  const { error: insertError } = await supabase.from('key_terms').insert(
    extractedTerms.map((term: ExtractedTerm) => ({
      contract_id,
      user_id:          user.id,
      term_name:        term.term_name,
      value:            term.value,
      page_number:      term.page_number ?? null,
      confidence_score: Math.min(1, Math.max(0, term.confidence_score)),
      source_sentence:  term.source_sentence ?? '',
      is_manual:        customTermSet.has(term.term_name.toLowerCase()),
    }))
  )

  if (insertError) {
    console.error('key_terms insert error:', insertError)
    await supabase.from('contracts').update({ status: 'error' }).eq('id', contract_id)
    return NextResponse.json({ error: 'Failed to save extracted terms' }, { status: 500 })
  }

  await supabase.from('contracts').update({ status: 'completed' }).eq('id', contract_id)

  return NextResponse.json({
    contract_id,
    terms_extracted: extractedTerms.length,
    status: 'completed',
  })
}
