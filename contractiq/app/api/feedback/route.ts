import { NextRequest, NextResponse }           from 'next/server'
import { createClient }                        from '@/lib/supabase/server'
import { requireAuth }                          from '@/lib/security/authGuard'
import { parseBody, feedbackBodySchema }        from '@/lib/security/inputValidator'

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { user } = auth

  // ── Validate body ─────────────────────────────────────────────────────────
  let rawBody: unknown
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseBody(feedbackBodySchema, rawBody)
  if (!parsed.success) return parsed.error
  const { contract_id, rating, comment } = parsed.data

  const trimmedComment = comment?.trim() || null

  // ── Verify contract ownership ─────────────────────────────────────────────
  const supabase = createClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id')
    .eq('id', contract_id)
    .eq('user_id', user.id)
    .single()

  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  const { data: feedback, error: upsertError } = await supabase
    .from('user_feedback')
    .upsert(
      { contract_id, user_id: user.id, rating, comment: trimmedComment },
      { onConflict: 'contract_id,user_id' }
    )
    .select('id, rating, comment, created_at')
    .single()

  if (upsertError || !feedback) {
    console.error('user_feedback upsert error:', upsertError)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
  }

  return NextResponse.json({ success: true, feedback }, { status: 201 })
}
