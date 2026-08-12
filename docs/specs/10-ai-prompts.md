# Spec 10 — AI Prompts Reference

**Stories:** US-003, US-004, US-007  
**Priority:** P0  
**Files touched:** `lib/openai/extraction.ts`, `lib/openai/chat.ts`

This spec is a single source of truth for every GPT-4o prompt used in ContractIQ. No prompt content should exist anywhere except these two files. When prompts change, update this document and the source files together.

---

## Extraction Prompts (`lib/openai/extraction.ts`)

### Standard Term Lists

```typescript
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

### Few-Shot Examples

#### `FEW_SHOT_NDA`

```
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
```

#### `FEW_SHOT_MSA`

```
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
```

---

### `buildExtractionPrompt()`

**System prompt** (verbatim, constructed at call time):

```
You are a contract analysis AI. Extract specific key terms from the provided contract text.

[FEW_SHOT_NDA or FEW_SHOT_MSA inserted here]

Rules:
1. Extract ONLY the terms listed in the user's message.
2. For each term, return the most specific value found — do not paraphrase beyond necessary.
3. page_number must be an integer matching the [PAGE N] marker where the clause appears (1-indexed).
4. confidence_score is a float between 0.0 and 1.0. Be honest — score low if you are uncertain.
5. source_sentence must be the verbatim sentence from the contract that you used to extract the value.
6. If a term is not found in the document, still include it with value="Not found", confidence_score=0.0, source_sentence="".
7. Return ONLY a valid JSON array. No explanation, no markdown, no preamble.
```

**User prompt** (verbatim, constructed at call time):

```
CONTRACT TYPE: [NDA or MSA]

TERMS TO EXTRACT:
1. [term 1]
2. [term 2]
... (all standard terms + custom terms, in order)

CONTRACT TEXT:
[full contract_text from DB, with [PAGE N] markers]
```

**OpenAI call parameters:**
- Model: `gpt-4o`
- Temperature: `0.1`
- Max tokens: `2000`
- Response format: `{ type: 'json_object' }`

**Retry prompt** (sent on JSON parse failure):

```
Your previous response was not valid JSON. Return ONLY the JSON array, no explanation, no markdown.
```

---

### JSON Unwrapping Logic

When `response_format: { type: 'json_object' }` is used, GPT-4o wraps array output in an object key. `parseExtractionResponse` unwraps it:

```typescript
const arr = Array.isArray(parsed)
  ? parsed
  : (parsed.terms ?? parsed.data ?? parsed.key_terms ?? null)
```

If none of these wrapper keys are found, `parseExtractionResponse` returns `null` and the retry prompt is sent.

---

## Chat Prompt (`lib/openai/chat.ts`)

### System Prompt (verbatim)

```
You are ContractIQ, an AI assistant that answers questions about legal contracts.

Rules:
1. Answer ONLY from the provided contract text. Do not invent clauses or reference knowledge outside the document.
2. Every answer that references a specific clause, obligation, or date MUST include a page citation in the format [Page X].
3. If the question cannot be answered from the contract text, respond: "I couldn't find that information in this contract."
4. Be concise and precise. Use plain English — avoid legal jargon where possible.
5. If a question asks for legal advice, clarify that you provide information only, not legal advice.
6. Structure multi-part answers with short bullet points.
```

The system prompt is extended at call time by appending the full contract text:

```
[SYSTEM PROMPT ABOVE]

CONTRACT TEXT:
[full contract_text from DB]
```

**User + history messages** are appended after the system message:
- History: last 40 rows from `chat_messages` (role + content), ordered ASC
- Final message: `{ role: 'user', content: question }`

**OpenAI call parameters:**
- Model: `gpt-4o`
- Temperature: `0.4`
- Max tokens: `1000`
- No `response_format` (plain text response)

---

## Prompt Injection Protection

Both prompts are server-side only. The contract text is injected into the system prompt (extraction) or appended to the system message (chat) — never placed directly into a user-controlled message role.

Risks mitigated:
- A malicious contract containing `"Ignore previous instructions"` is treated as document content, not as system instructions, because it arrives in the `user` role message (extraction) or as text appended to the system role (chat).
- The system prompt rules (Rules 1–7 for extraction; Rules 1–6 for chat) are always injected first, before contract content.

Additional server-side controls (implemented in Stage 7 via `/security-foundation`):
- Question length capped at 2,000 characters (validated in `POST /api/chat` route)
- Contract text size capped at 15,000 tokens before extraction (validated in `lib/pdf/validator.ts`)

---

## Token Budget

| Flow | Approximate input tokens | Output tokens |
|---|---|---|
| Extraction (NDA, 10 terms, 20-page contract) | ~8,000–12,000 | ~1,000–1,500 |
| Extraction (MSA, 12 terms, 20-page contract) | ~8,500–13,000 | ~1,200–1,800 |
| Chat (question + 20-message history + contract) | ~6,000–14,000 | ≤ 1,000 |

GPT-4o context window is 128k tokens. A 15,000-token contract + history stays well within limits.

---

## Model Selection Rationale

| Parameter | Extraction | Chat |
|---|---|---|
| Model | `gpt-4o` | `gpt-4o` |
| Temperature | `0.1` (high precision, deterministic) | `0.4` (some variability for natural-sounding answers) |
| Max tokens | `2000` (enough for 12 terms × ~150 tokens each) | `1000` (concise answers) |
| Response format | `json_object` (structured extraction) | None (plain prose) |

Lower temperature for extraction reduces hallucination risk in legal term values. Higher temperature for chat improves conversational quality without sacrificing grounding (the system prompt enforces document-only answers).

---

## Prompt Change Protocol

Before modifying any prompt:
1. Document the current prompt in this spec (compare to what's in source)
2. Make the change in both this file and the source file simultaneously
3. Re-run extraction on at least one NDA and one MSA sample to verify the output format
4. Check that all 10 / 12 standard terms are still extracted with correct JSON keys
