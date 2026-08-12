import { NextRequest, NextResponse }         from 'next/server'
import { createClient }                      from '@/lib/supabase/server'
import { requireAuth }                        from '@/lib/security/authGuard'
import { parseBody, termPatchSchema }         from '@/lib/security/inputValidator'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { user } = auth

  const termId = params.id

  // ── Validate body ─────────────────────────────────────────────────────────
  let rawBody: unknown
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseBody(termPatchSchema, rawBody)
  if (!parsed.success) return parsed.error
  const newValue = parsed.data.value.trim()

  if (!newValue) return NextResponse.json({ error: 'value cannot be empty' }, { status: 400 })

  // ── Fetch term + verify ownership ─────────────────────────────────────────
  const supabase = createClient()

  const { data: term } = await supabase
    .from('key_terms')
    .select('id, value, is_edited, original_value')
    .eq('id', termId)
    .eq('user_id', user.id)
    .single()

  if (!term) return NextResponse.json({ error: 'Term not found' }, { status: 404 })

  const previousValue = term.value

  const updatePayload: Record<string, unknown> = {
    value:     newValue,
    is_edited: true,
  }
  if (term.original_value === null) {
    updatePayload.original_value = previousValue
  }

  const { data: updated, error: updateError } = await supabase
    .from('key_terms')
    .update(updatePayload)
    .eq('id', termId)
    .eq('user_id', user.id)
    .select('id, term_name, value, is_edited, original_value, page_number, confidence_score, source_sentence, is_manual')
    .single()

  if (updateError || !updated) {
    console.error('key_terms update error:', updateError)
    return NextResponse.json({ error: 'Failed to save changes' }, { status: 500 })
  }

  // ── Log correction (non-fatal) ────────────────────────────────────────────
  supabase.from('term_corrections').insert({
    key_term_id:     termId,
    user_id:         user.id,
    original_value:  previousValue,
    corrected_value: newValue,
  }).then(({ error }: { error: unknown }) => {
    if (error) console.error('term_corrections insert error:', error)
  })

  return NextResponse.json(updated)
}
