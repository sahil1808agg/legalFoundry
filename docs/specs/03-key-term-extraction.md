# Spec 03 — Key Term Extraction via OpenAI

**Stories:** US-002 (process half), US-003, US-004, US-005  
**Priority:** P0  
**Files touched:** `app/api/process/route.ts`, `lib/openai/extraction.ts`, `lib/openai/client.ts`

---

## What to Build

`POST /api/process` reads `contract_text` from the database, builds a few-shot extraction prompt for the selected contract type, appends any user-defined custom terms, calls GPT-4o in JSON mode, validates the response, retries once on parse failure, and batch-inserts the results into `key_terms`.

---

## Acceptance Criteria

- [ ] `POST /api/process` returns 200 with `terms_extracted` count within 30 seconds P95 for ≤ 20-page contracts
- [ ] All 10 NDA standard terms (or all 12 MSA terms) appear in `key_terms` on success
- [ ] Custom terms appear in `key_terms` with `is_manual = true`
- [ ] Each `key_term` row has: `term_name`, `value`, `page_number`, `confidence_score` (0–1), `source_sentence`
- [ ] If GPT-4o returns invalid JSON: single automatic retry with correction prompt
- [ ] If retry also fails: `contracts.status = 'error'`; API returns 502
- [ ] If OpenAI is unavailable after 3 backoff attempts: `contracts.status = 'error'`; API returns 503
- [ ] `contracts.status` transitions: `pending → processing → completed` (or `error`)

---

## Standard Term Lists

```typescript
// lib/openai/extraction.ts

export const NDA_TERMS = [
  'Parties',
  'Effective Date',
  'Confidentiality Obligations',
  'Permitted Disclosures',
  'Term & Duration',
  'Governing Law',
  'Jurisdiction',
  'IP Ownership',
  'Non-Solicitation',
  'Breach & Remedy',
]

export const MSA_TERMS = [
  'Parties',
  'Service Scope',
  'Payment Terms',
  'Invoice Schedule',
  'Late Payment Penalty',
  'Liability Cap',
  'Indemnification',
  'IP Ownership',
  'Termination Clause',
  'Governing Law',
  'Dispute Resolution',
  'Notice Period',
]
```

---

## Extraction Prompt (Few-Shot)

```typescript
// lib/openai/extraction.ts

const FEW_SHOT_NDA = `
=== EXAMPLE 1 (NDA) ===
CONTRACT TEXT (excerpt): [PAGE 1]
This Non-Disclosure Agreement ("Agreement") is entered into as of January 15, 2024, between Acme Corp, a Delaware corporation ("Disclosing Party"), and Beta LLC, a California limited liability company ("Receiving Party").
[PAGE 2]
The Receiving Party agrees to hold all Confidential Information in strict confidence for a period of three (3) years from the date of disclosure.
[PAGE 3]
This Agreement shall be governed by and construed in accordance with the laws of the State of New York, without regard to conflict of law provisions.

EXTRACTION:
[
  {"term_name":"Parties","value":"Acme Corp (Disclosing Party) and Beta LLC (Receiving Party)","page_number":1,"confidence_score":0.98,"source_sentence":"This Non-Disclosure Agreement is entered into as of January 15, 2024, between Acme Corp, a Delaware corporation, and Beta LLC, a California limited liability company."},
  {"term_name":"Effective Date","value":"January 15, 2024","page_number":1,"confidence_score":0.99,"source_sentence":"This Non-Disclosure Agreement is entered into as of January 15, 2024."},
  {"term_name":"Term & Duration","value":"3 years from date of disclosure","page_number":2,"confidence_score":0.95,"source_sentence":"The Receiving Party agrees to hold all Confidential Information in strict confidence for a period of three (3) years from the date of disclosure."},
  {"term_name":"Governing Law","value":"New York","page_number":3,"confidence_score":0.97,"source_sentence":"This Agreement shall be governed by and construed in accordance with the laws of the State of New York."}
]
`

const FEW_SHOT_MSA = `
=== EXAMPLE 1 (MSA) ===
CONTRACT TEXT (excerpt): [PAGE 1]
This Master Service Agreement ("Agreement") is made as of March 1, 2024, between ServiceCo Inc. ("Provider") and ClientCorp Ltd. ("Client").
[PAGE 4]
Provider's aggregate liability under this Agreement shall not exceed the total fees paid by Client in the twelve (12) months preceding the claim.
[PAGE 6]
Either party may terminate this Agreement with thirty (30) days written notice.

EXTRACTION:
[
  {"term_name":"Parties","value":"ServiceCo Inc. (Provider) and ClientCorp Ltd. (Client)","page_number":1,"confidence_score":0.98,"source_sentence":"This Master Service Agreement is made as of March 1, 2024, between ServiceCo Inc. and ClientCorp Ltd."},
  {"term_name":"Liability Cap","value":"Total fees paid in the preceding 12 months","page_number":4,"confidence_score":0.93,"source_sentence":"Provider's aggregate liability under this Agreement shall not exceed the total fees paid by Client in the twelve (12) months preceding the claim."},
  {"term_name":"Termination Clause","value":"30 days written notice by either party","page_number":6,"confidence_score":0.96,"source_sentence":"Either party may terminate this Agreement with thirty (30) days written notice."}
]
`
```

### `buildExtractionPrompt()`

```typescript
export function buildExtractionPrompt(
  contractType: 'nda' | 'msa',
  contractText: string,
  customTerms: string[],
): { systemPrompt: string; userPrompt: string } {
  const standardTerms = contractType === 'nda' ? NDA_TERMS : MSA_TERMS
  const fewShot       = contractType === 'nda' ? FEW_SHOT_NDA : FEW_SHOT_MSA
  const allTerms      = [...standardTerms, ...customTerms]

  const systemPrompt = `You are a contract analysis AI. Extract specific key terms from the provided contract text.

${fewShot}

Rules:
1. Extract ONLY the terms listed in the user's message.
2. For each term, return the most specific value found — do not paraphrase beyond necessary.
3. page_number must be an integer matching the [PAGE N] marker where the clause appears (1-indexed).
4. confidence_score is a float between 0.0 and 1.0. Be honest — score low if you are uncertain.
5. source_sentence must be the verbatim sentence from the contract that you used to extract the value.
6. If a term is not found in the document, still include it with value="Not found", confidence_score=0.0, source_sentence="".
7. Return ONLY a valid JSON array. No explanation, no markdown, no preamble.`

  const userPrompt = `CONTRACT TYPE: ${contractType.toUpperCase()}

TERMS TO EXTRACT:
${allTerms.map((t, i) => `${i + 1}. ${t}`).join('\n')}

CONTRACT TEXT:
${contractText}`

  return { systemPrompt, userPrompt }
}
```

---

## `app/api/process/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildExtractionPrompt } from '@/lib/openai/extraction'
import { callExtractionWithRetry, parseExtractionResponse } from '@/lib/openai/extraction'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { contract_id?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { contract_id } = body
  if (!contract_id) return NextResponse.json({ error: 'contract_id is required' }, { status: 400 })

  // Fetch contract — verify ownership
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

  // Fetch custom terms
  const { data: customTermRows } = await supabase
    .from('custom_key_terms')
    .select('term_name')
    .eq('contract_id', contract_id)
    .order('created_at', { ascending: true })

  const customTerms = (customTermRows ?? []).map(r => r.term_name)

  // Mark as processing
  await supabase
    .from('contracts')
    .update({ status: 'processing' })
    .eq('id', contract_id)

  // Build prompt and call OpenAI
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
    const status = (err as { code?: number }).code === 503 ? 503 : 502
    return NextResponse.json({ error: 'AI extraction failed — please try again' }, { status })
  }

  // Determine which terms are custom
  const customTermSet = new Set(customTerms.map(t => t.toLowerCase()))

  // Batch insert key terms
  const { error: insertError } = await supabase.from('key_terms').insert(
    extractedTerms.map(term => ({
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
```

---

## `lib/openai/extraction.ts` — OpenAI Call + Retry Logic

```typescript
import { openai } from './client'

export interface ExtractedTerm {
  term_name:        string
  value:            string
  page_number:      number | null
  confidence_score: number
  source_sentence:  string
}

const RETRY_PROMPT = 'Your previous response was not valid JSON. Return ONLY the JSON array, no explanation, no markdown.'

export async function callExtractionWithRetry(
  systemPrompt: string,
  userPrompt:   string,
): Promise<ExtractedTerm[]> {
  // First attempt
  const firstResponse = await callOpenAIWithBackoff(systemPrompt, userPrompt)
  const firstParsed = parseExtractionResponse(firstResponse)
  if (firstParsed !== null) return firstParsed

  // Single retry with correction prompt
  const retryResponse = await callOpenAIWithBackoff(systemPrompt, RETRY_PROMPT)
  const retryParsed = parseExtractionResponse(retryResponse)
  if (retryParsed !== null) return retryParsed

  throw Object.assign(new Error('JSON parse failed after retry'), { code: 502 })
}

async function callOpenAIWithBackoff(
  systemPrompt: string,
  userContent:  string,
  maxAttempts = 3,
): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model:           'gpt-4o',
        temperature:     0.1,
        max_tokens:      2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent  },
        ],
      })
      return response.choices[0]?.message?.content ?? ''
    } catch (err) {
      if (attempt === maxAttempts) throw Object.assign(err as Error, { code: 503 })
      await sleep(2 ** (attempt - 1) * 1000) // 1s, 2s, 4s
    }
  }
  throw new Error('Unreachable')
}

export function parseExtractionResponse(raw: string): ExtractedTerm[] | null {
  try {
    const parsed = JSON.parse(raw)
    // GPT-4o json_object mode wraps arrays in an object key — unwrap if needed
    const arr = Array.isArray(parsed) ? parsed : (parsed.terms ?? parsed.data ?? parsed.key_terms ?? null)
    if (!Array.isArray(arr)) return null

    return arr.map((item: Record<string, unknown>) => ({
      term_name:        String(item.term_name ?? ''),
      value:            String(item.value ?? ''),
      page_number:      typeof item.page_number === 'number' ? item.page_number : null,
      confidence_score: typeof item.confidence_score === 'number' ? item.confidence_score : 0,
      source_sentence:  String(item.source_sentence ?? ''),
    }))
  } catch {
    return null
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
```

**Note on `json_object` mode:** When `response_format: { type: 'json_object' }` is used with an array output, GPT-4o wraps it in a key (e.g. `{ "terms": [...] }`). `parseExtractionResponse` handles this by trying multiple common wrapper keys before giving up.

---

## Confidence Score Display Rules

Applied in `components/contract/confidence-badge.tsx` (Spec 04):

| Score | CSS classes | Icon |
|---|---|---|
| ≥ 0.80 | `bg-[#E7F6E7] text-[#084406] border border-[#92D490]` | none |
| 0.50–0.79 | `bg-[#FFF9F0] text-[#854D00] border border-[#FFE3BD]` | none |
| < 0.50 | `bg-[#FAEBEB] text-[#581618] border border-[#EAA2A3]` | ⚠️ + tooltip |
| null (treat as 0) | Same as < 0.50 | ⚠️ + tooltip |

Tooltip text (non-dismissible, shown on hover of ⚠️):  
`"Low confidence — we recommend verifying this in the document directly."`

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Contract already `status='completed'` | Return 400 "Contract already processed" |
| OpenAI rate limit (429) | Backoff treats as transient error; retries up to 3 times |
| GPT-4o returns empty array `[]` | Valid — insert zero rows; `contracts.status = 'completed'` |
| `confidence_score` returned > 1.0 | `Math.min(1, ...)` clamps it before insert |
| Custom term not found in document | Extracted with `value="Not found"`, `confidence_score=0.0`; ⚠️ displayed in UI |
| Batch insert to `key_terms` fails | `contracts.status = 'error'`; return 500 |
