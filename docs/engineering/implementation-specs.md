# ContractIQ — Implementation Specs

**Version:** 1.0  
**Date:** 2026-08-12  
**Status:** Draft — Awaiting Approval  
**Companion doc:** `docs/engineering/engineering-doc.md`

This document contains one granular spec block per user story. Engineers build one spec at a time, in priority order. No code is written before the relevant spec block is reviewed.

---

## How to Use This Document

1. Pick the next unbuilt story (start at US-001)
2. Read the full spec block end-to-end before writing any code
3. Cross-reference `engineering-doc.md` for architecture context (DB schema, API shapes, folder structure)
4. Implement the feature; then mark the story as complete in the Feature Breakdown table in `engineering-doc.md`

---

## Spec Blocks

---

## US-001 — User Authentication (Sign Up / Sign In / Sign Out)

**Priority:** P0 | **Points:** 3

### User Flow

```
1. User arrives at / (landing page)
2. User clicks "Get Started Free"
   → Supabase Auth sign-up form renders (email + password fields)
3. User submits sign-up form
   → Supabase Auth creates user record + sends verification email
   → Frontend shows "Check your email to verify your account"
4. User clicks verification link in email
   → Supabase Auth marks email as verified
   → User is redirected to /dashboard
5. Returning user: arrives at / → clicks "Sign In"
   → Supabase Auth sign-in form renders
   → User submits credentials
   → On success: session cookie set; redirect to /dashboard
   → On failure: inline error "Incorrect email or password"
6. Sign Out: user clicks avatar/menu → "Sign Out"
   → Supabase Auth clears session
   → Redirect to /
```

### DB Schema

Managed entirely by Supabase Auth. No custom tables required at auth time.

| Table | Owner | Relevant columns |
|---|---|---|
| `auth.users` | Supabase | `id`, `email`, `email_confirmed_at`, `created_at` |

### DB Tasks

All performed via Supabase Auth client — no raw SQL:

```typescript
// Sign up
const { data, error } = await supabase.auth.signUp({ email, password })

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({ email, password })

// Sign out
await supabase.auth.signOut()

// Get current session (server components)
const { data: { user } } = await supabase.auth.getUser()
```

Next.js middleware (`middleware.ts`) calls `supabase.auth.getSession()` on every request to refresh the session token and redirect unauthenticated users away from protected routes (`/dashboard`, `/upload`, `/results/*`).

### API Routes

No custom API routes. Supabase Auth handles all auth operations directly from the client via `@supabase/ssr`.

Next.js middleware config:
```typescript
export const config = {
  matcher: ['/dashboard/:path*', '/upload/:path*', '/results/:path*']
}
```

### State Management

```typescript
// lib/supabase/client.ts — browser client for client components
createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)

// lib/supabase/server.ts — server client for API routes + server components
createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies })
```

Session is stored in a Supabase-managed HTTP-only cookie. No custom auth state library needed. `app/layout.tsx` wraps children with a Supabase session provider so `useUser()` works across all client components.

### Component Spec

**`components/auth/sign-up-form.tsx`**
- Props: none
- State: `email: string`, `password: string`, `loading: boolean`, `error: string | null`
- On submit: calls `supabase.auth.signUp()`; on success → show "Check your email" message; on error → set `error`
- Renders: two text inputs, submit button (disabled + spinner when `loading`), error message (if any)

**`components/auth/sign-in-form.tsx`**
- Props: none
- State: `email: string`, `password: string`, `loading: boolean`, `error: string | null`
- On submit: calls `supabase.auth.signInWithPassword()`; on success → `router.push('/dashboard')`; on error → set `error`
- Renders: two text inputs, submit button, error message, "Don't have an account? Sign up" link

**`middleware.ts`**
- Refreshes Supabase session on every matched request
- If no valid session on protected route → `NextResponse.redirect('/auth/sign-in')`
- If valid session on `/auth/*` → `NextResponse.redirect('/dashboard')`

### Design Notes

- Input fields use the design system's base input style (border, focus ring, label above)
- Submit button uses primary button variant (full-width on auth pages)
- Error message: red text, small font, appears below the submit button
- Loading state: button text replaced with spinner + "Signing in…" / "Creating account…"
- Auth pages use a centered card layout (max-w-sm) with the ContractIQ logo above
- No navigation bar on auth pages (clean, focused layout)

### Edge Cases

| Scenario | Handling |
|---|---|
| Email not yet verified on sign-in | Supabase returns error; show "Please verify your email before signing in" |
| Duplicate email on sign-up | Supabase returns error; show "An account with this email already exists" |
| Weak password (< 6 chars) | Supabase rejects; show "Password must be at least 6 characters" |
| Session cookie expires mid-session | Middleware refreshes automatically; if refresh fails → redirect to sign-in |
| User navigates to /dashboard without session | Middleware redirects to /auth/sign-in |
| User navigates to /auth/sign-in with valid session | Middleware redirects to /dashboard |
| Network error on auth call | Show "Something went wrong — please check your connection and try again" |

---

## US-002 — PDF Upload + Text Extraction

**Priority:** P0 | **Points:** 5

### User Flow

```
1. Authenticated user clicks "Review a Contract" on dashboard
   → Navigates to /upload
2. User selects contract type from dropdown (NDA or MSA)
   → Preview card updates to show the standard terms for the selected type
3. User drags and drops a PDF onto the drop zone (or clicks to file-pick)
   → Client validates: file type = application/pdf; size ≤ 10 MB
   → If invalid: inline error shown; no upload triggered
4. User optionally adds custom terms (see US-005)
5. User clicks "Process Contract"
   → Progress step 1 shown: "Extracting text…"
   → POST /api/upload fires (multipart)
   → On server: pdfjs-dist extracts text; validates page count (≤ 20), word count (≥ 100), token count (≤ 15,000)
   → DB: contracts row inserted with status='pending'; custom_key_terms inserted
   → Storage upload initiated (non-blocking)
   → Response: { contract_id }
   → Progress step 2 shown: "Analysing with AI…"
   → POST /api/process fires with { contract_id }
   → On server: reads contract_text from DB; builds extraction prompt; calls GPT-4o
   → DB: key_terms inserted; contracts.status = 'completed'
   → Progress step 3 shown: "Compiling results…"
   → Client navigates to /results/[contract_id]
```

### DB Schema

**`contracts`** (primary table for this feature):

| Column | Type | Set at upload |
|---|---|---|
| `id` | uuid | `gen_random_uuid()` |
| `user_id` | uuid | from auth session |
| `file_name` | text | original filename from File object |
| `contract_type` | text | 'nda' or 'msa' from form |
| `contract_text` | text | output of `extractTextFromPDF()` |
| `file_path` | text (nullable) | set after Storage upload succeeds |
| `status` | text | 'pending' → 'processing' → 'completed' / 'error' |
| `page_count` | integer | from pdfjs-dist page count |
| `token_count` | integer | approximated: `Math.ceil(text.length / 4)` |
| `created_at` | timestamptz | `now()` |

**`custom_key_terms`** (if custom terms provided):

| Column | Type | Value |
|---|---|---|
| `contract_id` | uuid | FK to newly created contract |
| `user_id` | uuid | from auth session |
| `term_name` | text | each custom term string |

### DB Tasks

```sql
-- 1. Insert contract record (in /api/upload)
INSERT INTO contracts (user_id, file_name, contract_type, contract_text, status, page_count, token_count)
VALUES ($1, $2, $3, $4, 'pending', $5, $6)
RETURNING id;

-- 2. Insert custom terms (in /api/upload, if any)
INSERT INTO custom_key_terms (contract_id, user_id, term_name)
VALUES ($1, $2, $3);  -- repeated for each term

-- 3. Update file_path after Storage upload (non-blocking, in /api/upload)
UPDATE contracts SET file_path = $1 WHERE id = $2;

-- 4. Update status to processing (in /api/process, at start)
UPDATE contracts SET status = 'processing' WHERE id = $1 AND user_id = $2;

-- 5. Read contract for extraction (in /api/process)
SELECT contract_text, contract_type FROM contracts WHERE id = $1 AND user_id = $2;
SELECT term_name FROM custom_key_terms WHERE contract_id = $1;

-- 6. Insert extracted key terms (in /api/process, batch)
INSERT INTO key_terms (contract_id, user_id, term_name, value, page_number, confidence_score, source_sentence, is_manual)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);  -- repeated for each term

-- 7. Update status to completed or error (in /api/process)
UPDATE contracts SET status = 'completed' WHERE id = $1;
-- or on failure:
UPDATE contracts SET status = 'error' WHERE id = $1;
```

### API Routes

**`POST /api/upload`**

```
Request: multipart/form-data
  file: File (PDF binary)
  contract_type: "nda" | "msa"
  custom_terms: JSON.stringify(string[])  ← up to 5 items

Server processing:
  1. Validate auth (createServerClient)
  2. Read file buffer from formData
  3. Validate: size ≤ 10_485_760 bytes; type = 'application/pdf'
  4. Call lib/pdf/extractor.ts: extractTextFromPDF(buffer) → { text, pageCount }
  5. Call lib/pdf/validator.ts: validatePDF(text, pageCount) → ValidationResult
     - page_count > 20 → throw 400
     - word_count < 100 → throw 422 ("Scanned PDFs are not supported yet")
     - token_count > 15_000 → throw 422 ("Contract exceeds the maximum supported length")
  6. INSERT contracts → get contract_id
  7. INSERT custom_key_terms (if any)
  8. Non-blocking: upload PDF buffer to Storage; UPDATE file_path on success

Response 201:
  { contract_id: string, page_count: number, token_count: number }
```

**`POST /api/process`**

```
Request: { contract_id: string }

Server processing:
  1. Validate auth; verify contract belongs to user
  2. Check status ≠ 'completed' (prevent double-processing)
  3. UPDATE status = 'processing'
  4. SELECT contract_text, contract_type, custom terms
  5. Call lib/openai/extraction.ts: buildExtractionPrompt(contractType, contractText, customTerms)
  6. Call lib/openai/extraction.ts: callExtraction(prompt) → raw JSON string
     - On parse failure: retry once with correction prompt
     - On second failure: UPDATE status='error'; return 502
     - On OpenAI timeout (3 retries): UPDATE status='error'; return 503
  7. Parse JSON → KeyTerm[]
  8. INSERT all key_terms (batch)
  9. UPDATE status = 'completed'

Response 200:
  { contract_id: string, terms_extracted: number, status: "completed" }
```

### State Management

In `app/upload/page.tsx` (client component):

```typescript
type UploadStep = 'idle' | 'extracting' | 'analysing' | 'done' | 'error'

const [step, setStep] = useState<UploadStep>('idle')
const [contractType, setContractType] = useState<'nda' | 'msa' | null>(null)
const [file, setFile] = useState<File | null>(null)
const [customTerms, setCustomTerms] = useState<string[]>([])
const [errorMessage, setErrorMessage] = useState<string | null>(null)

// On "Process Contract" click:
// setStep('extracting') → await POST /api/upload
// setStep('analysing') → await POST /api/process
// setStep('done') → router.push(`/results/${contract_id}`)
// on error: setStep('error'); setErrorMessage(...)
```

### Component Spec

**`components/contract/contract-type-select.tsx`**
- Props: `value: 'nda' | 'msa' | null`, `onChange: (v: 'nda' | 'msa') => void`
- Renders: styled `<select>` with placeholder option + "NDA" + "MSA"

**`components/contract/contract-uploader.tsx`**
- Props: `onFileSelected: (file: File) => void`, `disabled: boolean`
- State: `isDragging: boolean`
- Renders: dashed border drop zone; "Drag PDF here or click to browse" text; `<input type="file" accept="application/pdf">`
- On file drop/pick: validate MIME type + size client-side; call `onFileSelected` if valid; show inline error if invalid
- Shows selected filename once file is chosen

**`components/contract/term-preview-card.tsx`**
- Props: `contractType: 'nda' | 'msa' | null`, `customTerms: string[]`
- Renders: card listing standard terms for the selected type + any custom terms (with "Custom" badge)
- Standard NDA terms: Parties, Effective Date, Confidentiality Obligations, Permitted Disclosures, Term & Duration, Governing Law, Jurisdiction, IP Ownership, Non-Solicitation, Breach & Remedy
- Standard MSA terms: Parties, Service Scope, Payment Terms, Invoice Schedule, Late Payment Penalty, Liability Cap, Indemnification, IP Ownership, Termination Clause, Governing Law, Dispute Resolution, Notice Period

**`components/contract/process-button.tsx`**
- Props: `step: UploadStep`, `onProcess: () => void`, `disabled: boolean`
- Renders: "Process Contract" button (primary) in idle state
- In extracting/analysing states: shows step progress UI (three steps, current step highlighted with spinner)
- In error state: shows error banner with retry button

### Design Notes

- Drop zone: 2px dashed border, `border-dashed border-2 border-gray-300 rounded-xl`; changes to `border-primary` on drag-over
- File selected state: drop zone shows filename with a PDF icon and an ✕ button to remove
- Progress steps: three labelled steps (Step 1 / 2 / 3); current step has a spinning circle; completed steps have a green checkmark
- "Process Contract" button: disabled until both `contractType` and `file` are set
- Error banner: red background, warning icon, clear message text, "Try Again" button on right

### Edge Cases

| Scenario | Handling |
|---|---|
| File > 10 MB | Client-side: inline error "File must be under 10 MB" before upload |
| Non-PDF file selected | Client-side: "Only PDF files are accepted" |
| Contract > 20 pages | Server returns 400; client shows "This contract is too long (max 20 pages)" |
| Scanned PDF (< 100 words extracted) | Server returns 422; client shows "Scanned PDFs are not supported yet. Please upload a text-based PDF." |
| Token count > 15,000 | Server returns 422; client shows "Contract is too long for analysis (max ~15,000 tokens)" |
| OpenAI unavailable (503) | Error banner with "Analysis failed — please try again in a few minutes"; contracts.status='error' |
| User navigates away mid-processing | On return to /dashboard, contract shows 'processing' badge; user can click to retry |
| Storage upload fails | Non-blocking; `file_path` stays null; extraction still runs; PDF viewer hides on results page |

---

## US-003 — Page Number Attribution Per Key Term

**Priority:** P0 | **Points:** 3

### User Flow

```
1. User is on /results/[id] after successful extraction
2. Each term in the KeyTermsPanel shows a page number chip (e.g. "p.4")
3. User clicks the page chip on any term
   → targetPage state is updated in the parent (results page)
   → PDFViewer (or TextViewerFallback) receives the new targetPage prop
   → Viewer scrolls/jumps to that page
   → The page is briefly highlighted (visual feedback)
```

### DB Schema

No schema changes. This feature reads `key_terms.page_number` (already populated by US-002/extraction).

| Column | Table | Type | Notes |
|---|---|---|---|
| `page_number` | `key_terms` | `integer` | 1-indexed; set by GPT-4o extraction |

### DB Tasks

```sql
-- Already fetched as part of GET /api/contracts/[id] (no separate query)
SELECT id, term_name, value, page_number, confidence_score, source_sentence, is_edited, is_manual
FROM key_terms
WHERE contract_id = $1 AND user_id = $2
ORDER BY is_manual ASC, term_name ASC;
```

### API Routes

No new route. `GET /api/contracts/[id]` already returns `page_number` in each key term object. No changes needed to the route.

### State Management

In `app/results/[id]/page.tsx`:

```typescript
const [targetPage, setTargetPage] = useState<number | null>(null)

// Passed down to:
// <KeyTermsPanel onPageClick={(page) => setTargetPage(page)} />
// <PDFViewer targetPage={targetPage} />
// <TextViewerFallback targetPage={targetPage} />
```

`targetPage` is controlled state in the results page — both viewers are purely reactive to this prop.

### Component Spec

**`components/contract/term-card.tsx`** (page chip behaviour)
- Props include: `pageNumber: number | null`, `onPageClick: (page: number) => void`
- Renders a clickable chip: `"p.{pageNumber}"` styled as `cursor-pointer underline text-primary text-sm`
- If `pageNumber` is null: chip not rendered (term had no page attribution)
- On click: `onPageClick(pageNumber)`

**`components/contract/pdf-viewer.tsx`** (targetPage response)
- Props include: `targetPage: number | null`
- `useEffect([targetPage])`: when `targetPage` changes and PDF is loaded → `pdfViewerInstance.currentPageNumber = targetPage`
- After scroll: briefly adds a highlight class to the target page container, then removes it after 1.5s

**`components/contract/text-viewer-fallback.tsx`** (targetPage response)
- Props include: `targetPage: number | null`
- Parses `[PAGE N]` markers from `contract_text` to build an array of page sections
- `useEffect([targetPage])`: when `targetPage` changes → `document.getElementById(`page-${targetPage}`).scrollIntoView({ behavior: 'smooth' })`
- Each page section is rendered with `id="page-{n}"` and a `"Page N"` label header

### Design Notes

- Page chip: small pill with border, `text-xs font-mono`, primary colour text on hover
- The chip sits on the right side of each TermCard row, after the confidence badge
- On click, the chip momentarily shows an active/pressed state (darker background)
- In the PDF viewer: target page gets a subtle yellow background highlight for 1.5 seconds
- In the text viewer: target page section gets the same highlight treatment

### Edge Cases

| Scenario | Handling |
|---|---|
| `page_number` is null (extraction missed it) | Page chip is not rendered; no click action |
| Viewer not yet mounted when chip is clicked | `targetPage` is set; once viewer mounts, `useEffect` runs and scrolls |
| `page_number` is out of range (e.g. page 25 on a 12-page doc) | Clamp to last page; no error thrown |
| Both viewers unmounted (transitioning) | React reconciler handles; `useEffect` cleanup prevents scroll on unmounted DOM |

---

## US-004 — Confidence Score Display Per Term

**Priority:** P0 | **Points:** 3

### User Flow

```
1. User is on /results/[id]
2. Each TermCard shows a confidence badge: green (≥ 80%), amber (50–79%), red (< 50%)
3. Terms with confidence < 50% also show a ⚠️ icon
4. User hovers the ⚠️ icon → non-dismissible tooltip appears:
   "Low confidence — we recommend verifying this in the document directly."
5. User clicks "Why?" link on any term → source sentence expands below the term value
```

### DB Schema

| Column | Table | Type | Constraint |
|---|---|---|---|
| `confidence_score` | `key_terms` | `numeric(5,4)` | CHECK BETWEEN 0 AND 1 |
| `source_sentence` | `key_terms` | `text` | NOT NULL |

### DB Tasks

```sql
-- Already included in GET /api/contracts/[id] query — no additional tasks
```

### API Routes

No changes. `GET /api/contracts/[id]` returns `confidence_score` (as a float) and `source_sentence` for each term.

### State Management

```typescript
// Per-term expansion state in key-terms-panel.tsx
const [expandedTermId, setExpandedTermId] = useState<string | null>(null)
// No global state needed — purely local to the panel
```

### Component Spec

**`components/contract/confidence-badge.tsx`**
- Props: `score: number` (0.0–1.0)
- Derives colour: score ≥ 0.80 → `'green'`; score ≥ 0.50 → `'amber'`; else → `'red'`
- Renders: coloured pill showing `"{Math.round(score * 100)}%"`
- If score < 0.50: also renders a ⚠️ icon with tooltip text (not dismissible; shown inline)
- Handles null/undefined score: treats as 0 (red + warning)
- Handles score > 1.0: clamps to 1.0

**`components/contract/source-tooltip.tsx`**
- Props: `sourceSentence: string`, `termId: string`, `isExpanded: boolean`, `onToggle: () => void`
- Renders: "Why?" link (small, secondary colour)
- When `isExpanded`: shows `sourceSentence` in a grey `<blockquote>` below the term value
- Animation: smooth height transition on expand/collapse

**`components/contract/term-card.tsx`** (integration)
- Renders `<ConfidenceBadge score={term.confidence_score} />`
- Renders `<SourceTooltip ... />` if `source_sentence` is present
- If `is_edited`: shows "Edited" amber badge next to term name

### Design Notes

- Green: `bg-green-100 text-green-800 border border-green-200`
- Amber: `bg-amber-100 text-amber-800 border border-amber-200`
- Red: `bg-red-100 text-red-800 border border-red-200`
- ⚠️ icon: inline, same size as badge text, positioned to the right of the badge
- Tooltip: shown on hover of ⚠️ icon; uses the design system tooltip component (appears above the icon, max-width 200px)
- "Why?" link: `text-xs text-gray-500 underline hover:text-gray-700 cursor-pointer`, placed below the term value

### Edge Cases

| Scenario | Handling |
|---|---|
| `confidence_score` is null | Treat as 0; show red badge + ⚠️ warning |
| `confidence_score` = 0.50 exactly | Amber (rule: score ≥ 0.50 → amber; < 0.50 → red) |
| `confidence_score` > 1.0 (model error) | Clamp to 1.0; show green badge |
| `source_sentence` is empty string | Do not render "Why?" link |
| Multiple terms expanded at once | Only allow one expanded at a time (setExpandedTermId replaces previous) |

---

## US-005 — Custom Key Term Addition Before Processing

**Priority:** P0 | **Points:** 4

### User Flow

```
1. On /upload page, after selecting contract type
2. User sees the term preview card listing standard terms
3. User clicks "+ Add Key Term"
   → Text input appears below the preview list
4. User types a term name (e.g. "Non-compete radius") and presses Enter or clicks "Add"
   → Term appears in the preview list with a "Custom" badge
   → Input clears, ready for another term
5. Repeat up to 5 custom terms (button disables at 5)
6. User can remove a custom term by clicking ✕ on its chip
7. User clicks "Process Contract"
   → custom_terms array sent with POST /api/upload
   → Extraction prompt includes custom terms
   → Results show custom terms with same structure as standard terms, plus "Custom" badge
```

### DB Schema

**`custom_key_terms`** table:

| Column | Type | Constraint |
|---|---|---|
| `id` | uuid | PK |
| `contract_id` | uuid | FK → contracts(id) ON DELETE CASCADE |
| `user_id` | uuid | FK → auth.users(id) ON DELETE CASCADE |
| `term_name` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL default now() |

**`key_terms`** table (result rows for custom terms):

| Column | Value for custom terms |
|---|---|
| `is_manual` | `true` |
| All other columns | Same structure as standard terms |

### DB Tasks

```sql
-- INSERT custom terms at upload time (repeated for each term)
INSERT INTO custom_key_terms (contract_id, user_id, term_name)
VALUES ($1, $2, $3);

-- SELECT custom terms at processing time (in /api/process)
SELECT term_name FROM custom_key_terms WHERE contract_id = $1 ORDER BY created_at ASC;

-- INSERT results for custom terms (same batch as standard terms in /api/process)
INSERT INTO key_terms (contract_id, user_id, term_name, value, page_number, confidence_score, source_sentence, is_manual)
VALUES ($1, $2, $3, $4, $5, $6, $7, true);
```

### API Routes

**`POST /api/upload`** (extended)
- Accepts `custom_terms` as a JSON-encoded string in the multipart form data
- Server parses and validates: array of strings; length ≤ 5; each string ≤ 100 chars; no empty strings
- Inserts each into `custom_key_terms`

**`POST /api/process`** (reads custom terms from DB)
- After fetching `contract_text`, also fetches custom term names from `custom_key_terms`
- Appends custom terms to the extraction prompt:

```typescript
// In lib/openai/extraction.ts
function buildExtractionPrompt(contractType, contractText, customTerms) {
  const standardTerms = contractType === 'nda' ? NDA_TERMS : MSA_TERMS
  const allTerms = [...standardTerms, ...customTerms]
  // ... build few-shot prompt with allTerms
}
```

### State Management

In `app/upload/page.tsx`:

```typescript
const [customTerms, setCustomTerms] = useState<string[]>([])
const MAX_CUSTOM_TERMS = 5

function addCustomTerm(name: string) {
  if (customTerms.length >= MAX_CUSTOM_TERMS) return
  if (!name.trim()) return
  setCustomTerms(prev => [...prev, name.trim()])
}

function removeCustomTerm(index: number) {
  setCustomTerms(prev => prev.filter((_, i) => i !== index))
}
```

### Component Spec

**`components/contract/custom-term-adder.tsx`**
- Props: `terms: string[]`, `onAdd: (name: string) => void`, `onRemove: (index: number) => void`, `maxTerms: number`
- State: `inputValue: string`
- Renders:
  - List of added terms as dismissible chips (term name + ✕ button)
  - Text input (hidden or shown via "+ Add Key Term" toggle)
  - "Add" button (or Enter key) to submit the input
  - "+ Add Key Term" button — disabled and shows tooltip "Maximum 5 custom terms" when `terms.length >= maxTerms`
- Input validation: trim whitespace; ignore empty; max 100 chars

**`components/contract/term-preview-card.tsx`** (updated to show custom terms)
- Props: `contractType: 'nda' | 'msa' | null`, `customTerms: string[]`
- Renders standard terms as a plain list
- Appends custom terms with a "Custom" badge (distinct colour: indigo/purple)

**`components/contract/term-card.tsx`** (on results page — custom term indicator)
- If `term.is_manual === true`: shows "Custom" badge next to the term name

### Design Notes

- "+ Add Key Term" button: secondary/outline style, small size, placed below the standard terms list in the preview card
- Custom term chip in preview: `bg-indigo-100 text-indigo-800 border border-indigo-200` to distinguish from standard terms (which have no badge)
- ✕ on chip: `text-gray-400 hover:text-gray-700`; removes the term on click
- Input field: appears inline in the preview card; auto-focused when "+ Add Key Term" is clicked
- On results page: "Custom" badge uses the same indigo style as in the preview card for consistency

### Edge Cases

| Scenario | Handling |
|---|---|
| User tries to add 6th term | "+ Add Key Term" button is disabled; tooltip: "Maximum 5 custom terms" |
| Empty term name submitted | `addCustomTerm` ignores empty/whitespace strings; no error shown |
| Term name > 100 characters | Input blocks further typing at 100 chars; character counter shown below input |
| Duplicate term name | Allowed — user's choice; both will appear in extraction results |
| Custom term not found in contract | GPT-4o will return a low-confidence extraction or an empty value; same confidence display rules apply |
| Server rejects custom_terms (validation failure) | `POST /api/upload` returns 400; client shows "Custom terms are invalid — please review and try again" |

---

## US-006 — Inline PDF Viewer

**Priority:** P1 | **Points:** 5

### User Flow

```
1. User arrives at /results/[id]
2. Page fetches contract data including signed_url from GET /api/contracts/[id]
3. If signed_url is present:
   → Left panel renders PDFViewer (PDF.js)
   → PDF pages load progressively (lazy loading)
   → User can scroll through all pages, zoom in/out using toolbar controls
4. User clicks a page chip in the KeyTermsPanel
   → targetPage state updates
   → PDFViewer scrolls smoothly to that page; page briefly highlights
5. If signed_url is null (Storage unavailable):
   → TextViewerFallback renders silently — no error shown to user
```

### DB Schema

| Column | Table | Notes |
|---|---|---|
| `file_path` | `contracts` | Null if Storage upload failed; used to generate signed URL |

### DB Tasks

```typescript
// In /api/contracts/[id], server-side:
const { data: { file_path } } = await supabase
  .from('contracts')
  .select('file_path')
  .eq('id', contractId)
  .eq('user_id', userId)
  .single()

// Generate signed URL if file_path is set
let signedUrl: string | null = null
if (file_path) {
  const { data } = await supabase.storage
    .from('contracts')
    .createSignedUrl(file_path, 3600)  // 1-hour expiry
  signedUrl = data?.signedUrl ?? null
}
```

### API Routes

**`GET /api/contracts/[id]`** (returns `signed_url`)

```json
{
  "contract": { ... },
  "key_terms": [ ... ],
  "signed_url": "https://...supabase.co/storage/v1/object/sign/contracts/...",
  "contract_text": "..."
}
```

`signed_url` is a string (valid URL) or `null`. The client renders `PDFViewer` if present, `TextViewerFallback` if null.

### State Management

In `app/results/[id]/page.tsx`:

```typescript
const [targetPage, setTargetPage] = useState<number | null>(null)

// signedUrl and contractText come from the server-fetched data (server component)
// targetPage is controlled by the parent; passed to both viewers
```

`PDFViewer` manages its own internal PDF.js state (page count, current page, zoom level). It is a client component with `'use client'`.

### Component Spec

**`components/contract/pdf-viewer.tsx`**
- Props: `signedUrl: string`, `targetPage: number | null`, `totalPages: number`
- Client component (`'use client'`)
- Initialises PDF.js `PDFViewer` using the signed URL
- Lazy loading: only renders pages within `±2` of the current viewport page
- `useEffect([targetPage])`: scrolls to `targetPage` when it changes; adds 1.5s highlight class
- Toolbar: zoom in (`+`), zoom out (`–`), current page display ("Page X of N")
- On PDF.js load failure: renders a "Download PDF" link (`<a href={signedUrl} download>`)

**`components/contract/text-viewer-fallback.tsx`**
- Props: `contractText: string`, `targetPage: number | null`
- Parses `[PAGE N]` markers from `contractText` into an array of `{ pageNum, content }` sections
- Renders each section as a `<section id="page-{n}">` with a `"— Page N —"` header
- `useEffect([targetPage])`: scrolls to `document.getElementById('page-{n}')` with smooth behavior; applies 1.5s highlight

### Design Notes

- Left panel: 55% of results page width on desktop; collapses to a "View Document" tab on mobile
- PDF.js toolbar: positioned above the viewer, sticky; minimal controls (zoom + page indicator)
- Page highlight: `bg-yellow-50 transition-colors duration-1500` — briefly applied then removed
- Text viewer fallback: each page section separated by a horizontal rule; monospace-like font for the text content; `"— Page N —"` label in `text-sm text-gray-400 text-center`
- No error banner when falling back to text viewer — it's seamless

### Edge Cases

| Scenario | Handling |
|---|---|
| `signed_url` is null | `TextViewerFallback` renders; no notification to user |
| `signed_url` has expired mid-session | PDF.js fetch fails; render "Download PDF" fallback link |
| PDF.js cannot render (unusual fonts/layout) | PDF.js error event → show "Download PDF" fallback link; text viewer still available via tab |
| PDF is very large (20 pages) | Lazy loading: only `±2` pages rendered at any time |
| `targetPage` is 0 or negative | Clamp to 1 |
| `targetPage` > total page count | Clamp to total page count |
| User zooms in heavily | PDF.js handles internally; no custom state needed |

---

## US-007 — Contract Chat (Q&A)

**Priority:** P1 | **Points:** 8

### User Flow

```
1. User is on /results/[id], clicks "Chat" tab
2. ChatInterface loads; fetches existing messages from DB (if any — see US-012)
3. User types a question in the textarea (e.g. "What happens if I breach the NDA?")
4. User presses Enter or clicks "Send"
   → Message appears immediately in the chat (optimistic render)
   → Typing indicator (three dots) appears
   → POST /api/chat fires
5. Server fetches contract_text + full chat history
6. Server classifies query type; builds GPT-4o messages array
7. GPT-4o responds with a grounded answer + [Page X] citation
8. Assistant message appears in chat; typing indicator disappears
9. User can click [Page X] citation → viewer scrolls to that page
10. Repeat from step 3
```

### DB Schema

**`chat_sessions`**:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `contract_id` | uuid | FK → contracts(id) |
| `user_id` | uuid | FK → auth.users(id) |
| `created_at` | timestamptz | |

**`chat_messages`**:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `session_id` | uuid | FK → chat_sessions(id) |
| `user_id` | uuid | FK → auth.users(id) |
| `role` | text | `'user'` or `'assistant'` |
| `content` | text | Message text |
| `created_at` | timestamptz | Ascending order = conversation order |

### DB Tasks

```sql
-- 1. Get or create chat session (in /api/chat)
SELECT id FROM chat_sessions
WHERE contract_id = $1 AND user_id = $2
LIMIT 1;

-- If none exists:
INSERT INTO chat_sessions (contract_id, user_id)
VALUES ($1, $2)
RETURNING id;

-- 2. Fetch all messages for context
SELECT role, content FROM chat_messages
WHERE session_id = $1
ORDER BY created_at ASC
LIMIT 200;

-- 3. Get contract text for context
SELECT contract_text FROM contracts
WHERE id = $1 AND user_id = $2;

-- 4. Insert user message
INSERT INTO chat_messages (session_id, user_id, role, content)
VALUES ($1, $2, 'user', $3)
RETURNING id, created_at;

-- 5. Insert assistant message (after OpenAI responds)
INSERT INTO chat_messages (session_id, user_id, role, content)
VALUES ($1, $2, 'assistant', $3)
RETURNING id, created_at;
```

### API Routes

**`POST /api/chat`**

```
Request: { contract_id: string, question: string }

Validation:
  - question: not empty; max 2,000 characters
  - contract_id: exists and belongs to auth.uid()
  - contracts.status: must be 'completed' (cannot chat with failed contract)

Server processing:
  1. Get or create chat_sessions row
  2. Fetch all chat_messages for session (ASC, up to 200)
  3. Fetch contracts.contract_text
  4. INSERT user message
  5. Classify query: 'contract' | 'history' | 'both'
     - Contains "earlier" / "before" / "you said" / "previously" → 'history'
     - Otherwise → 'contract' (always include full contract text)
  6. Build GPT-4o messages array:
     [
       { role: 'system', content: CHAT_SYSTEM_PROMPT_WITH_CONTRACT_TEXT },
       ...history_messages,
       { role: 'user', content: question }
     ]
  7. Call GPT-4o (temperature=0.4, max_tokens=1000)
  8. On timeout (3 retries): return 503 with retry message
  9. INSERT assistant message
  10. Return response

Response 200:
  {
    session_id: string,
    message: {
      id: string,
      role: "assistant",
      content: "Based on the document, if you breach the NDA... [Page 4]",
      created_at: string
    }
  }
```

**System prompt template** (in `lib/openai/chat.ts`):

```
You are a contract review assistant. Answer questions ONLY from the document text provided below.
If the answer is not in the document, respond: "I cannot find this in the document."
Begin every response with: "Based on the document..."
Every response MUST include a citation in the format: [Page X]

CONTRACT TEXT:
{contractText}
```

### State Management

```typescript
// hooks/useChat.ts
interface UseChatReturn {
  messages: ChatMessage[]
  isLoading: boolean
  sessionId: string | null
  sendMessage: (question: string) => Promise<void>
  loadHistory: (contractId: string) => Promise<void>
  error: string | null
}

// Internal state:
const [messages, setMessages] = useState<ChatMessage[]>([])
const [isLoading, setIsLoading] = useState(false)
const [sessionId, setSessionId] = useState<string | null>(null)

// On sendMessage:
// 1. Optimistic: append user message to messages
// 2. setIsLoading(true)
// 3. POST /api/chat
// 4. Append assistant message to messages
// 5. setIsLoading(false)
// On error: remove optimistic message; set error

// Page citation callback:
// chat-interface receives onPageCitation: (page: number) => void
// from results/[id]/page.tsx, which calls setTargetPage(page)
```

### Component Spec

**`components/chat/chat-interface.tsx`**
- Props: `contractId: string`, `onPageCitation: (page: number) => void`
- Uses `useChat` hook
- On mount: calls `loadHistory(contractId)`
- Renders: scrollable message list + textarea + send button
- Auto-scrolls to bottom on new message
- On send: validates non-empty; calls `sendMessage(question)`; clears textarea
- Shows typing indicator when `isLoading`

**`components/chat/chat-message.tsx`**
- Props: `message: ChatMessage`
- User messages: right-aligned, primary background
- Assistant messages: left-aligned, light grey background
- Parses `[Page X]` citations in content using regex: `/\[Page (\d+)\]/g`
- Renders each citation as a clickable teal chip: calls `onPageCitation(pageNum)` on click

### Design Notes

- Chat panel: right side of results page on desktop; full-screen overlay on mobile
- Textarea: 3 rows default; grows up to 8 rows with content; Enter sends (Shift+Enter for newline)
- Send button: icon-only (paper plane icon); disabled when textarea is empty or loading
- Typing indicator: three dots animation in an assistant message bubble
- "Based on the document…" prefix: styled in `text-gray-500 italic` for the first few words to visually distinguish the framing
- `[Page X]` chip: `bg-teal-100 text-teal-700 rounded px-1 text-xs font-medium cursor-pointer hover:bg-teal-200`
- 15s timeout warning: shown as a small inline message below the typing indicator after 10s

### Edge Cases

| Scenario | Handling |
|---|---|
| Empty question submitted | "Send" button disabled; Enter key does nothing |
| Question > 2,000 characters | Textarea character counter shown; "Send" disabled above limit |
| OpenAI timeout (503) | Error banner in chat: "Response timed out — please try again" + retry button |
| OpenAI answers from general knowledge (hallucination) | System prompt prevents this; automated regression test validates the "I cannot find this" response path |
| Contract status is 'error' (extraction failed) | Chat tab disabled with tooltip: "Chat is unavailable for contracts that failed to process" |
| `[Page X]` in message where X > total pages | Page citation chip still shows; viewer clamps to last page |
| Chat session has 200+ messages | Fetch all up to 200; older messages displayed in UI but oldest excluded from GPT-4o context array |
| Network error during send | Revert optimistic message; show error "Message could not be sent — check your connection" |

---

## US-008 — Dashboard with Contract History

**Priority:** P1 | **Points:** 5

### User Flow

```
1. Authenticated user arrives at /dashboard
2. Page fetches contracts via GET /api/dashboard (server component initial fetch)
3. Summary cards show: total contracts reviewed; count by type (NDA / MSA)
4. If no contracts: empty state renders with "Upload your first contract" CTA
5. If contracts exist: sortable table renders
   - Columns: Contract Name | Type | Date Uploaded | Status
   - Default sort: Date Uploaded (newest first)
   - User clicks a column header to toggle sort asc/desc
6. User clicks any table row → navigates to /results/[id]
7. If a contract has status='error': row shows "Failed" badge + "Retry" link
```

### DB Schema

| Table | Columns read |
|---|---|
| `contracts` | `id`, `file_name`, `contract_type`, `status`, `page_count`, `created_at` |

### DB Tasks

```sql
-- Fetch paginated contract list (in /api/dashboard)
SELECT id, file_name, contract_type, status, page_count, created_at
FROM contracts
WHERE user_id = $1
ORDER BY {sort_column} {sort_direction}
LIMIT $2 OFFSET $3;

-- Count total (for pagination and summary cards)
SELECT COUNT(*) as total,
       COUNT(CASE WHEN contract_type = 'nda' THEN 1 END) as nda_count,
       COUNT(CASE WHEN contract_type = 'msa' THEN 1 END) as msa_count
FROM contracts
WHERE user_id = $1;
```

### API Routes

**`GET /api/dashboard`**

```
Query params: page (default 1), limit (default 20, max 50), sort_by, sort_dir

Validation:
  - sort_by: only allow 'created_at' | 'file_name' | 'contract_type' (whitelist to prevent injection)
  - sort_dir: only allow 'asc' | 'desc'

Response 200:
  {
    contracts: [{ id, file_name, contract_type, status, page_count, created_at }],
    total: number,
    nda_count: number,
    msa_count: number,
    page: number,
    limit: number
  }
```

### State Management

```typescript
// hooks/useDashboard.ts
interface UseDashboardReturn {
  contracts: Contract[]
  total: number
  ndaCount: number
  msaCount: number
  page: number
  sortBy: 'created_at' | 'file_name' | 'contract_type'
  sortDir: 'asc' | 'desc'
  isLoading: boolean
  setSortBy: (col: SortColumn) => void
  toggleSortDir: () => void
  setPage: (n: number) => void
}
```

Initial data is fetched server-side in the `app/dashboard/page.tsx` server component and passed as props. Client-side sorting/pagination re-fetches via the hook.

### Component Spec

**`components/dashboard/summary-cards.tsx`**
- Props: `total: number`, `ndaCount: number`, `msaCount: number`
- Renders two cards: "Total Reviews: {total}" and "By Type: {ndaCount} NDA / {msaCount} MSA"

**`components/dashboard/dashboard-table.tsx`**
- Props: `contracts: Contract[]`, `sortBy`, `sortDir`, `onSortChange`, `onRowClick`
- Renders a `<table>` with sortable column headers (click to sort; shows ↑↓ indicator)
- Each row: contract name (truncated at 40 chars with tooltip for full name) | type badge | formatted date | status badge
- Status badges: completed=green, processing=amber, error=red
- Error row: additionally shows a "Retry" link that navigates to `/upload` (pre-filling would be nice but out of MVP scope)
- Row click: `onRowClick(contract.id)` → `router.push('/results/{id}')`

**`components/dashboard/empty-state.tsx`**
- Props: none
- Renders: centered illustration (contract icon), "No contracts reviewed yet", "Upload your first contract" primary button → `/upload`

### Design Notes

- Summary cards: side by side (2-column grid), same height, subtle shadow, border
- Table: zebra striping on alternating rows; hover state darkens row slightly; cursor pointer on rows
- "Contract Name" column: max 40 chars visible; full name in native browser tooltip (`title` attribute)
- Date: formatted as "12 Aug 2026" (day month year, no time)
- Status badge: same colour system as confidence badges but for contract status
- Sort indicator: `↑` for ASC, `↓` for DESC, `↕` for unsorted; positioned right of column header text

### Edge Cases

| Scenario | Handling |
|---|---|
| No contracts yet | `empty-state.tsx` renders; no empty table |
| Contract with `status='error'` | Red "Failed" badge; "Retry" link in row (links to /upload) |
| Contract with `status='processing'` | Amber "Processing" badge; row is not clickable (disabled cursor) |
| File name is very long | Truncated to 40 chars in cell; full name in `title` attribute |
| > 20 contracts | Pagination controls below table; "Showing 1–20 of {total}" |
| Sort by file_name with special characters | Postgres handles collation; no special treatment needed |

---

## US-009 — Inline Key Term Editing

**Priority:** P1 | **Points:** 3

### User Flow

```
1. User is on /results/[id], looking at the KeyTermsPanel
2. User clicks anywhere on a term's value text
   → Term card switches to edit mode: input pre-filled with current value
   → Save and Cancel buttons appear
3. User modifies the value
4. User clicks "Save"
   → Optimistic update: term value updates immediately in UI
   → PATCH /api/terms/[id] fires
   → DB: key_terms updated; term_corrections row inserted
   → "Edited" badge (amber) appears next to the term name
   → Hovering "Edited" badge shows tooltip: "AI suggested: {original_value}"
5. If user clicks "Cancel": input dismissed; original value restored
```

### DB Schema

**`key_terms`** (columns updated by this feature):

| Column | Updated to |
|---|---|
| `value` | User's corrected value |
| `is_edited` | `true` |
| `original_value` | AI's original value (set only on first edit; never overwritten again) |

**`term_corrections`** (new row per edit):

| Column | Type | Value |
|---|---|---|
| `key_term_id` | uuid | FK to edited key_term |
| `user_id` | uuid | from auth session |
| `original_value` | text | value before this edit |
| `corrected_value` | text | value after this edit |
| `created_at` | timestamptz | now() |

### DB Tasks

```sql
-- In PATCH /api/terms/[id]:

-- 1. Fetch current term to get original_value
SELECT value, is_edited, original_value FROM key_terms
WHERE id = $1 AND user_id = $2;

-- 2. Update the term
UPDATE key_terms
SET
  value = $1,
  is_edited = true,
  original_value = CASE WHEN is_edited = false THEN value ELSE original_value END
WHERE id = $2 AND user_id = $3;

-- 3. Log correction (always, even on re-edit)
INSERT INTO term_corrections (key_term_id, user_id, original_value, corrected_value)
VALUES ($1, $2, $3, $4);
```

Note: `original_value` is only set on the first edit. On subsequent edits, it stays as the first AI value. `term_corrections` logs every edit for the prompt improvement loop.

### API Routes

**`PATCH /api/terms/[id]`**

```
Request: { value: string }

Validation:
  - value: not empty; not only whitespace; max 500 characters

Server processing:
  1. Verify key_term belongs to auth.uid()
  2. Read current value and is_edited flag
  3. UPDATE key_terms (value, is_edited=true, original_value if first edit)
  4. INSERT term_corrections
  5. Return updated term

Response 200:
  {
    id: string,
    value: string,
    is_edited: true,
    original_value: string
  }
```

### State Management

```typescript
// In hooks/useContract.ts
const [editingTermId, setEditingTermId] = useState<string | null>(null)
const [terms, setTerms] = useState<KeyTerm[]>(initialTerms)

async function saveTerm(termId: string, newValue: string) {
  // 1. Optimistic update
  setTerms(prev => prev.map(t => t.id === termId ? { ...t, value: newValue, is_edited: true } : t))
  setEditingTermId(null)

  // 2. PATCH request
  const { data, error } = await patchTerm(termId, newValue)

  // 3. On error: revert optimistic update + show error toast
  if (error) {
    setTerms(prev => /* revert */ ...)
    showErrorToast("Could not save edit — please try again")
  }
  // On success: update original_value in local state from response
}
```

### Component Spec

**`components/contract/term-card.tsx`** (mode switching)
- Props: `term: KeyTerm`, `isEditing: boolean`, `onEdit: () => void`, `onSave: (value: string) => void`, `onCancel: () => void`
- Display mode: term value is clickable (`cursor-pointer hover:bg-gray-50`); renders `<TermInlineEditor>` if `isEditing`
- Shows "Edited" amber badge after `term.is_edited === true`
- Badge tooltip: "AI suggested: {term.original_value}"

**`components/contract/term-inline-editor.tsx`**
- Props: `initialValue: string`, `onSave: (value: string) => void`, `onCancel: () => void`
- State: `value: string` (controlled input)
- Renders: `<input>` pre-filled with `initialValue`; "Save" primary button; "Cancel" ghost button
- Validates on Save: not empty + not whitespace
- Keyboard: Enter = Save; Escape = Cancel

### Design Notes

- Clicking the value area: entire value row gets a subtle hover background to hint it's editable
- Edit mode: input replaces the static text; slightly indented; full width of the value column
- "Save" button: small, primary colour, to the right of the input
- "Cancel" button: small, ghost/text style, next to Save
- "Edited" badge: `bg-amber-100 text-amber-800 border border-amber-200 text-xs rounded-full px-2`; sits immediately after the term name
- Edit completes within 2 seconds P95 (PATCH round trip)

### Edge Cases

| Scenario | Handling |
|---|---|
| Save with empty string | Validation error inline: "Value cannot be empty" |
| Save with only whitespace | Same validation — treat as empty |
| Network error on PATCH | Revert optimistic update; show error toast |
| User edits the same term twice | `original_value` stays as the AI's first value (never overwritten by a user edit) |
| User presses Escape during edit | Cancel — restores display mode with original value |
| Another user's term (wrong user_id) | PATCH returns 404; frontend shows generic error |

---

## US-010 — Feedback Rating Submission

**Priority:** P2 | **Points:** 2

### User Flow

```
1. User is on /results/[id], at the bottom of the KeyTermsPanel (above the disclaimer)
2. FeedbackWidget shows two buttons: 👍 and 👎
3. User clicks one
   → Button highlights (filled icon); optional comment textarea appears
4. User optionally types a comment
5. User clicks "Submit Feedback"
   → POST /api/feedback fires
   → On success: buttons become disabled; "Thank you for your feedback!" message shown
6. If user re-opens the same results page: previous rating is shown (buttons pre-filled)
```

### DB Schema

**`user_feedback`**:

| Column | Type | Constraint |
|---|---|---|
| `id` | uuid | PK |
| `contract_id` | uuid | FK → contracts(id) |
| `user_id` | uuid | FK → auth.users(id) |
| `rating` | text | `'up'` or `'down'` |
| `comment` | text (nullable) | max 1,000 chars |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE (contract_id, user_id)` — one feedback per user per contract.

### DB Tasks

```sql
-- Check for existing feedback (on results page load)
SELECT rating, comment FROM user_feedback
WHERE contract_id = $1 AND user_id = $2;

-- Submit / update feedback (UPSERT)
INSERT INTO user_feedback (contract_id, user_id, rating, comment)
VALUES ($1, $2, $3, $4)
ON CONFLICT (contract_id, user_id)
DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()
RETURNING id, rating, created_at;
```

### API Routes

**`POST /api/feedback`**

```
Request: { contract_id: string, rating: 'up' | 'down', comment?: string }

Validation:
  - rating: must be 'up' or 'down'
  - comment: optional; max 1,000 characters
  - contract_id: must exist and belong to auth.uid()

Server processing:
  1. Validate inputs
  2. UPSERT into user_feedback
  3. Return result

Response 201:
  { id: string, rating: 'up' | 'down', created_at: string }
```

### State Management

```typescript
// Local to components/ui/feedback-widget.tsx
const [selectedRating, setSelectedRating] = useState<'up' | 'down' | null>(existingRating)
const [comment, setComment] = useState(existingComment ?? '')
const [submitted, setSubmitted] = useState(!!existingRating)
const [isLoading, setIsLoading] = useState(false)
```

`existingRating` and `existingComment` are fetched as part of `GET /api/contracts/[id]` (add a `feedback` field to the response from a LEFT JOIN on `user_feedback`).

### Component Spec

**`components/ui/feedback-widget.tsx`**
- Props: `contractId: string`, `existingRating?: 'up' | 'down'`, `existingComment?: string`
- State: `selectedRating`, `comment`, `submitted`, `isLoading`
- Renders:
  - "Was this review helpful?" label
  - 👍 and 👎 buttons (outlined when unselected, filled when selected)
  - Textarea (shown after rating is selected; placeholder: "What could be improved? (optional)")
  - Character counter below textarea (e.g. "145 / 1000")
  - "Submit Feedback" primary button (shown after rating selected)
  - After submission: buttons disabled; "Thank you for your feedback!" text
- Does not render if `submitted` is true on load (already submitted)... actually: renders as read-only (shows submitted rating, disabled)

### Design Notes

- 👍 / 👎: large icon buttons (32px icons), `rounded-full`, focus ring on keyboard nav
- Selected state: `bg-primary text-white` for the chosen button; unselected fades to `text-gray-400`
- Textarea: auto-resizes up to 4 rows; shown with slide-down animation after rating selected
- "Submit Feedback" button: full-width, primary style; shows spinner while `isLoading`
- Widget placed in a card with a subtle border, at the bottom of the KeyTermsPanel

### Edge Cases

| Scenario | Handling |
|---|---|
| Submit without selecting a rating | "Submit Feedback" button is hidden until a rating is selected |
| Comment > 1,000 chars | Textarea blocks further input; character counter turns red |
| API error on submit | Toast: "Feedback could not be saved — please try again"; buttons re-enabled |
| User already submitted feedback (reload page) | Widget pre-fills with existing rating; shows disabled state with "Thank you!" |
| User changes rating after submission | UPSERT handles it; widget stays in "submitted" state with updated rating |

---

## US-011 — Export Key Terms to CSV / PDF

**Priority:** P2 | **Points:** 4

### User Flow

```
1. User is on /results/[id] with extraction completed
2. "Export" dropdown button visible in top-right of KeyTermsPanel
3. User clicks "Export" → dropdown shows "Export CSV" and "Export PDF"
4. User clicks "Export CSV"
   → Client-side: constructs CSV string from key_terms array
   → Downloads file: "{contract_name}_key_terms.csv"
5. User clicks "Export PDF"
   → Client-side: uses @react-pdf/renderer to build PDF
   → Downloads file: "{contract_name}_review.pdf"
6. File downloads within 5 seconds
```

### DB Schema

No DB changes. Export reads from `key_terms` already loaded in memory via `useContract`.

### DB Tasks

None. Data already fetched by `GET /api/contracts/[id]`.

### API Routes

None. Export is entirely client-side:
- CSV: `Blob` with `text/csv` MIME type → `URL.createObjectURL()` → `<a download>` click
- PDF: `@react-pdf/renderer` `pdf()` function → `Blob` → `URL.createObjectURL()` → download

### State Management

```typescript
// In components/contract/export-button.tsx (local state only)
const [isExporting, setIsExporting] = useState(false)
const [dropdownOpen, setDropdownOpen] = useState(false)
```

Uses `key_terms` from parent's `useContract` hook (passed as props).

### Component Spec

**`components/contract/export-button.tsx`**
- Props: `terms: KeyTerm[]`, `contractName: string`, `disabled: boolean`
- State: `dropdownOpen`, `isExporting`
- Renders: "Export ▾" button; dropdown with "Export CSV" and "Export PDF" options
- `disabled` when `terms.length === 0`

**CSV generation** (in `lib/export/csv.ts`):
```typescript
export function generateCSV(terms: KeyTerm[]): string {
  const headers = ['Term Name', 'Value', 'Page Number', 'Confidence (%)', 'Source Sentence', 'Edited']
  const rows = terms.map(t => [
    t.term_name,
    t.value,
    t.page_number ?? '',
    Math.round(t.confidence_score * 100),
    t.source_sentence,
    t.is_edited ? 'Yes' : 'No'
  ])
  return [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}
```

**PDF generation** (in `lib/export/pdf.tsx`):
- Uses `@react-pdf/renderer` with a simple template:
  - Header: ContractIQ logo + contract name + date generated
  - Table: Term Name | Value | Page | Confidence | Edited
  - Footer: "Generated by ContractIQ — not legal advice"

### Design Notes

- Export button: secondary/outline style, placed in the top-right corner of the KeyTermsPanel header
- Dropdown: appears below the button; each option has a file-type icon (CSV grid icon, PDF icon)
- While exporting: spinner on the Export button; dropdown closes
- Disabled state (no terms): button is `opacity-50 cursor-not-allowed`; tooltip: "No terms to export"

### Edge Cases

| Scenario | Handling |
|---|---|
| `terms.length === 0` | Export button disabled with tooltip |
| Very long source sentences in CSV | CSV wraps in double-quotes; internal quotes escaped as `""` |
| Browser blocking file download | Toast: "Your browser blocked the download — please allow downloads from this site" |
| PDF generation fails | Show error toast: "Export failed — please try again" |
| Term name or value contains commas | CSV quoting handles this correctly |

---

## US-012 — Persistent Chat History Per Contract

**Priority:** P1 | **Points:** 3

### User Flow

```
1. User previously reviewed a contract and asked questions in the chat
2. User navigates away and returns to /results/[id] later
3. Chat tab opens
4. ChatInterface calls loadHistory(contractId) on mount
5. Previous messages load from DB in ascending chronological order
6. Messages render in the chat — seamlessly, as if the conversation never ended
7. User can continue from where they left off
8. If no prior history: placeholder text shown ("Ask anything about this contract")
```

### DB Schema

Same tables as US-007:

| Table | Relevant for this story |
|---|---|
| `chat_sessions` | Looked up by `contract_id + user_id` to retrieve `session_id` |
| `chat_messages` | All messages for the session, ordered by `created_at ASC` |

### DB Tasks

```sql
-- 1. Find existing session
SELECT id FROM chat_sessions
WHERE contract_id = $1 AND user_id = $2
LIMIT 1;

-- 2. If found, fetch all messages
SELECT id, role, content, created_at
FROM chat_messages
WHERE session_id = $1
ORDER BY created_at ASC;
-- (Up to 200 rows — this is also the limit for GPT-4o context)
```

### API Routes

No new route. History loading is handled either:
- **Option A (recommended):** Include `session_id` and initial `messages` in the `GET /api/contracts/[id]` response to avoid a second round-trip on results page load
- **Option B:** `useChat.loadHistory()` fires a separate `GET /api/chat/history?contract_id=X` on mount

**Chosen approach: Option A** — extend `GET /api/contracts/[id]` response:

```json
{
  "contract": { ... },
  "key_terms": [ ... ],
  "signed_url": "...",
  "contract_text": "...",
  "chat_session": {
    "session_id": "uuid-or-null",
    "messages": [
      { "id": "...", "role": "user", "content": "...", "created_at": "..." },
      { "id": "...", "role": "assistant", "content": "...", "created_at": "..." }
    ]
  }
}
```

If no session exists: `chat_session: { session_id: null, messages: [] }`.

### State Management

```typescript
// hooks/useChat.ts (extended from US-007)

// Initialisation from server-fetched data:
function useChat(initialSession: { session_id: string | null, messages: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialSession.messages)
  const [sessionId, setSessionId] = useState<string | null>(initialSession.session_id)
  // ...
}
```

The `initialSession` is passed from `app/results/[id]/page.tsx` (server component) which already has the data from the initial fetch. No secondary API call needed.

### Component Spec

**`components/chat/chat-interface.tsx`** (updated for US-012)
- Props: `contractId: string`, `initialMessages: ChatMessage[]`, `initialSessionId: string | null`, `onPageCitation: (page: number) => void`
- Passes `{ session_id, messages }` to `useChat` as initial state
- On mount: scroll to bottom of messages list (if history exists)
- If `initialMessages.length === 0`: renders placeholder "Ask anything about this contract" in centre of message area
- Loading skeleton: shown while `GET /api/contracts/[id]` is still resolving (server component handles this with `loading.tsx` or Suspense)

### Design Notes

- History loads instantly on page open (no separate loading state needed — data is server-fetched)
- No visual separator between old and new messages — seamless chat experience
- If > 20 messages: shows a "scroll to top to see earlier messages" hint at the top of the list
- Placeholder: centered grey text with a chat bubble icon; disappears as soon as first message loads

### Edge Cases

| Scenario | Handling |
|---|---|
| No prior session exists | `messages: []`; show placeholder; session created on first send (US-007 flow) |
| Session exists but messages were deleted | Messages array is empty; same as no prior session |
| 200+ messages in session | Fetch all up to 200; UI displays all; GPT-4o context uses up to 200 (oldest truncated if over) |
| Very long message content | CSS `break-words` prevents overflow; no UI truncation (user wrote it) |
| Network error fetching history | The whole `GET /api/contracts/[id]` fails → results page shows error state; not chat-specific |
| Message content contains markdown | Not rendered as markdown in MVP (plain text only); prevents potential XSS |

---

*All 12 spec blocks complete. Stage 1 is now fully delivered. Review both `engineering-doc.md` and `implementation-specs.md`, then confirm you are ready to move to Stage 2 — Implementation Specs (`/implementation-specs`).*
