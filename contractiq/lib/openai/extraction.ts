import { openai } from './client'

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

const RETRY_PROMPT = 'Your previous response was not valid JSON. Return ONLY the JSON array, no explanation, no markdown.'

export interface ExtractedTerm {
  term_name:        string
  value:            string
  page_number:      number | null
  confidence_score: number
  source_sentence:  string
}

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

export async function callExtractionWithRetry(
  systemPrompt: string,
  userPrompt: string,
): Promise<ExtractedTerm[]> {
  const firstResponse = await callOpenAIWithBackoff(systemPrompt, userPrompt)
  const firstParsed   = parseExtractionResponse(firstResponse)
  if (firstParsed !== null) return firstParsed

  const retryResponse = await callOpenAIWithBackoff(systemPrompt, RETRY_PROMPT)
  const retryParsed   = parseExtractionResponse(retryResponse)
  if (retryParsed !== null) return retryParsed

  throw Object.assign(new Error('JSON parse failed after retry'), { code: 502 })
}

async function callOpenAIWithBackoff(
  systemPrompt: string,
  userContent: string,
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
      await sleep(2 ** (attempt - 1) * 1000)
    }
  }
  throw new Error('Unreachable')
}

export function parseExtractionResponse(raw: string): ExtractedTerm[] | null {
  try {
    const parsed = JSON.parse(raw)
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed.terms ?? parsed.data ?? parsed.key_terms ?? parsed.results ?? null)
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

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
