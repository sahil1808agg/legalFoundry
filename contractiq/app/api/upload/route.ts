import { NextRequest, NextResponse }       from 'next/server'
import { createClient }                    from '@/lib/supabase/server'
import { extractTextFromPDF }              from '@/lib/pdf/extractor'
import { validatePDF }                     from '@/lib/pdf/validator'
import { requireAuth }                     from '@/lib/security/authGuard'
import { checkRateLimit }                  from '@/lib/security/rateLimiter'
import { validateFileUpload }              from '@/lib/security/inputValidator'

const MAX_CUSTOM_TERMS = 5

export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { user } = auth

  // ── Rate limit: 20 / day ─────────────────────────────────────────────────
  const rl = await checkRateLimit(user.id, 'upload')
  if (rl.limited) return rl.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file          = formData.get('file') as File | null
  const contractType  = formData.get('contract_type') as string | null
  const customTermsRaw = formData.get('custom_terms') as string | null

  if (!file) return NextResponse.json({ error: 'File is required' }, { status: 400 })

  // ── File validation ───────────────────────────────────────────────────────
  const fileCheck = validateFileUpload(file)
  if (!fileCheck.valid) return fileCheck.error

  // ── Contract type validation ──────────────────────────────────────────────
  if (contractType !== 'nda' && contractType !== 'msa') {
    return NextResponse.json({ error: 'contract_type must be "nda" or "msa"' }, { status: 400 })
  }

  // ── Custom terms ──────────────────────────────────────────────────────────
  let customTerms: string[] = []
  if (customTermsRaw) {
    try {
      const parsed = JSON.parse(customTermsRaw)
      if (Array.isArray(parsed)) {
        customTerms = parsed
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map(t => t.trim().slice(0, 100))
          .slice(0, MAX_CUSTOM_TERMS)
      }
    } catch {
      customTerms = []
    }
  }

  // ── PDF extraction + validation ───────────────────────────────────────────
  const buffer = await file.arrayBuffer()

  let extractionResult: Awaited<ReturnType<typeof extractTextFromPDF>>
  try {
    extractionResult = await extractTextFromPDF(buffer)
  } catch (err) {
    console.error('PDF extraction error:', err)
    return NextResponse.json({ error: 'Failed to read PDF. The file may be corrupted.' }, { status: 422 })
  }

  const { text, pageCount } = extractionResult
  const validation = validatePDF(text, pageCount)
  if (!validation.valid) {
    console.error('PDF validation failed:', validation.error, { pageCount, chars: text.length })
    return NextResponse.json({ error: validation.error }, { status: 422 })
  }

  const tokenCount = validation.tokenCount!

  // ── Insert contract row ───────────────────────────────────────────────────
  const supabase = createClient()

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .insert({
      user_id:       user.id,
      file_name:     file.name,
      contract_type: contractType,
      contract_text: text,
      status:        'pending',
      page_count:    pageCount,
      token_count:   tokenCount,
    })
    .select('id')
    .single()

  if (contractError || !contract) {
    console.error('contracts insert error:', contractError)
    return NextResponse.json({ error: 'Failed to save contract' }, { status: 500 })
  }

  const contractId = contract.id

  // ── Insert custom_key_terms rows ──────────────────────────────────────────
  if (customTerms.length > 0) {
    const { error: termsError } = await supabase.from('custom_key_terms').insert(
      customTerms.map(term => ({
        contract_id: contractId,
        user_id:     user.id,
        term_name:   term,
      }))
    )
    if (termsError) {
      console.error('custom_key_terms insert error:', termsError)
    }
  }

  // ── Non-blocking Storage upload ───────────────────────────────────────────
  uploadToStorage(supabase, user.id, contractId, file.name, buffer)

  return NextResponse.json(
    {
      contract_id:        contractId,
      page_count:         pageCount,
      token_count:        tokenCount,
      custom_terms_saved: customTerms,
    },
    { status: 201 }
  )
}

function uploadToStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  contractId: string,
  fileName: string,
  buffer: ArrayBuffer,
) {
  const path = `${userId}/${contractId}/${fileName}`
  supabase.storage
    .from('contracts')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: false })
    .then(({ error }: { error: unknown }) => {
      if (error) {
        console.error('Storage upload error:', error)
        return
      }
      supabase
        .from('contracts')
        .update({ file_path: path })
        .eq('id', contractId)
        .then(({ error: updateError }: { error: unknown }) => {
          if (updateError) console.error('file_path update error:', updateError)
        })
    })
    .catch((err: unknown) => console.error('Storage upload exception:', err))
}
