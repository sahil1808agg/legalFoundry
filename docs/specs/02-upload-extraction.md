# Spec 02 — PDF Upload & Text Extraction

**Stories:** US-002 (upload half)  
**Priority:** P0  
**Files touched:** `app/api/upload/route.ts`, `lib/pdf/extractor.ts`, `lib/pdf/validator.ts`, `app/upload/page.tsx`, `components/contract/contract-uploader.tsx`, `components/contract/contract-type-select.tsx`, `components/contract/term-preview-card.tsx`, `components/contract/custom-term-adder.tsx`, `components/contract/process-button.tsx`

---

## What to Build

The upload flow: user selects a contract type and PDF → client validates → multipart POST to `/api/upload` → server extracts text with `pdfjs-dist` → validates constraints → inserts `contracts` row → uploads PDF to Storage (non-blocking) → returns `contract_id` → client then fires `POST /api/process`.

---

## Acceptance Criteria

- [ ] Only `application/pdf` files are accepted; other types show "Only PDF files are accepted"
- [ ] Files > 10 MB are rejected client-side before upload with "File must be under 10 MB"
- [ ] Server rejects contracts > 20 pages (400) with "This contract is too long (max 20 pages)"
- [ ] Server rejects extracted text < 100 words (422) with "Scanned PDFs are not supported yet"
- [ ] Server rejects token count > 15,000 (422) with "Contract is too long for analysis"
- [ ] On success: `contracts` row is inserted with `status='pending'`; `custom_key_terms` rows inserted
- [ ] Storage upload failure does NOT block the API response — `file_path` stays null, pipeline continues
- [ ] The 3-step progress indicator (Extracting → Analysing → Compiling) renders correctly during processing

---

## `app/api/upload/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractTextFromPDF } from '@/lib/pdf/extractor'
import { validatePDF } from '@/lib/pdf/validator'

const MAX_FILE_BYTES  = 10 * 1024 * 1024  // 10 MB
const MAX_CUSTOM_TERMS = 5

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse multipart form data
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file         = formData.get('file') as File | null
  const contractType = formData.get('contract_type') as string | null
  const customTermsRaw = formData.get('custom_terms') as string | null

  // Validate inputs
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!['nda', 'msa'].includes(contractType ?? '')) {
    return NextResponse.json({ error: 'contract_type must be "nda" or "msa"' }, { status: 400 })
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File must be under 10 MB' }, { status: 400 })
  }

  let customTerms: string[] = []
  if (customTermsRaw) {
    try {
      customTerms = JSON.parse(customTermsRaw)
      if (!Array.isArray(customTerms)) throw new Error()
      customTerms = customTerms
        .map((t: unknown) => (typeof t === 'string' ? t.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_CUSTOM_TERMS)
    } catch {
      return NextResponse.json({ error: 'Invalid custom_terms format' }, { status: 400 })
    }
  }

  // Extract text
  const buffer = await file.arrayBuffer()
  let extraction: { text: string; pageCount: number }
  try {
    extraction = await extractTextFromPDF(buffer)
  } catch (err) {
    console.error('PDF extraction error:', err)
    return NextResponse.json({ error: 'Could not read this PDF. Please try a different file.' }, { status: 422 })
  }

  // Validate extracted content
  const validation = validatePDF(extraction.text, extraction.pageCount)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 422 })
  }

  // Insert contracts row
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .insert({
      user_id:       user.id,
      file_name:     file.name,
      contract_type: contractType,
      contract_text: extraction.text,
      status:        'pending',
      page_count:    extraction.pageCount,
      token_count:   validation.tokenCount!,
    })
    .select('id')
    .single()

  if (contractError || !contract) {
    console.error('contracts insert error:', contractError)
    return NextResponse.json({ error: 'Failed to save contract' }, { status: 500 })
  }

  // Insert custom terms (if any)
  if (customTerms.length > 0) {
    await supabase.from('custom_key_terms').insert(
      customTerms.map(term_name => ({
        contract_id: contract.id,
        user_id:     user.id,
        term_name,
      }))
    )
    // Custom term insert failure is non-fatal — log and continue
  }

  // Non-blocking: upload PDF to Storage
  // Failure here only hides the PDF viewer; the AI pipeline uses contract_text from DB
  uploadToStorage(supabase, buffer, file.name, user.id, contract.id).catch(console.error)

  return NextResponse.json({
    contract_id:  contract.id,
    page_count:   extraction.pageCount,
    token_count:  validation.tokenCount,
  }, { status: 201 })
}

async function uploadToStorage(
  supabase: ReturnType<typeof createClient>,
  buffer: ArrayBuffer,
  fileName: string,
  userId: string,
  contractId: string,
) {
  const filePath = `contracts/${userId}/${contractId}/${fileName}`

  const { error } = await supabase.storage
    .from('contracts')
    .upload(filePath, buffer, { contentType: 'application/pdf', upsert: false })

  if (error) {
    console.error('Storage upload error (non-fatal):', error)
    return
  }

  await supabase
    .from('contracts')
    .update({ file_path: filePath })
    .eq('id', contractId)
}
```

---

## `lib/pdf/extractor.ts` — Full Implementation

```typescript
export interface ExtractionResult {
  text: string
  pageCount: number
}

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<ExtractionResult> {
  // Dynamic import keeps pdfjs-dist out of the client bundle
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const pageTexts: string[] = []

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pageTexts.push(`[PAGE ${pageNum}]\n${text}`)
  }

  return {
    text: pageTexts.join('\n\n'),
    pageCount,
  }
}
```

---

## `lib/pdf/validator.ts` — Full Implementation

```typescript
export interface ValidationResult {
  valid:       boolean
  error?:      string
  wordCount?:  number
  tokenCount?: number
}

const MAX_PAGES  = 20
const MIN_WORDS  = 100
const MAX_TOKENS = 15_000

export function validatePDF(text: string, pageCount: number): ValidationResult {
  if (pageCount > MAX_PAGES) {
    return { valid: false, error: `This contract is too long (max ${MAX_PAGES} pages, found ${pageCount})` }
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount < MIN_WORDS) {
    return { valid: false, error: 'Scanned PDFs are not supported yet. Please upload a text-based PDF.' }
  }

  // Approximate GPT token count: 1 token ≈ 4 characters
  const tokenCount = Math.ceil(text.length / 4)
  if (tokenCount > MAX_TOKENS) {
    return {
      valid: false,
      error: `Contract is too long for analysis (approx. ${tokenCount.toLocaleString()} tokens; max ${MAX_TOKENS.toLocaleString()})`,
    }
  }

  return { valid: true, wordCount, tokenCount }
}
```

---

## Upload Page Components

### `components/contract/contract-type-select.tsx`

```typescript
'use client'

interface Props {
  value: 'nda' | 'msa' | null
  onChange: (v: 'nda' | 'msa') => void
  disabled?: boolean
}

export function ContractTypeSelect({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-[#070A0E]">Contract type</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value as 'nda' | 'msa')}
        disabled={disabled}
        className="input-base"
      >
        <option value="" disabled>Select type…</option>
        <option value="nda">NDA — Non-Disclosure Agreement</option>
        <option value="msa">MSA — Master Service Agreement</option>
      </select>
    </div>
  )
}
```

### `components/contract/contract-uploader.tsx`

```typescript
'use client'
import { useRef, useState } from 'react'

const MAX_FILE_BYTES = 10 * 1024 * 1024

interface Props {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

export function ContractUploader({ onFileSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  function validate(file: File): string | null {
    if (file.type !== 'application/pdf') return 'Only PDF files are accepted.'
    if (file.size > MAX_FILE_BYTES) return 'File must be under 10 MB.'
    return null
  }

  function handleFile(file: File) {
    const err = validate(file)
    if (err) { setError(err); return }
    setError(null)
    setSelectedFile(file)
    onFileSelected(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-[#070A0E]">Contract PDF</label>
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging ? 'border-[#115ACB] bg-[#E7EFFC]' : 'border-[#DADADB] hover:border-[#115ACB]',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          disabled={disabled}
        />
        {selectedFile ? (
          <div className="flex items-center justify-center gap-2 text-sm text-[#070A0E]">
            <span>📄</span>
            <span className="font-medium">{selectedFile.name}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setSelectedFile(null); setError(null) }}
              className="text-[#4A4C4F] hover:text-[#D13438] ml-1"
            >
              ✕
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-[#4A4C4F]">Drag &amp; drop your PDF here, or click to browse</p>
            <p className="text-xs text-[#8F9193] mt-1">PDF only · Max 10 MB · Max 20 pages</p>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-[#D13438]">{error}</p>
      )}
    </div>
  )
}
```

### `components/contract/process-button.tsx`

```typescript
'use client'

export type UploadStep = 'idle' | 'extracting' | 'analysing' | 'done' | 'error'

const STEPS = [
  { key: 'extracting', label: 'Extracting text' },
  { key: 'analysing',  label: 'Analysing with AI' },
  { key: 'done',       label: 'Compiling results' },
]

interface Props {
  step: UploadStep
  onProcess: () => void
  disabled: boolean
  errorMessage?: string | null
  onRetry?: () => void
}

export function ProcessButton({ step, onProcess, disabled, errorMessage, onRetry }: Props) {
  if (step === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <div className="bg-[#FAEBEB] border border-[#EAA2A3] rounded-lg px-4 py-3 text-sm text-[#942528]">
          {errorMessage ?? 'Analysis failed — please try again'}
        </div>
        <button onClick={onRetry} className="btn-secondary">Try Again</button>
      </div>
    )
  }

  if (step !== 'idle') {
    const currentIdx = STEPS.findIndex(s => s.key === step)
    return (
      <div className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-3 text-sm">
            <span className={[
              'w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0',
              i < currentIdx  ? 'border-[#13A10E] bg-[#13A10E] text-white'          : '',
              i === currentIdx ? 'border-[#115ACB] border-t-transparent animate-spin' : '',
              i > currentIdx  ? 'border-[#DADADB]'                                    : '',
            ].join(' ')}>
              {i < currentIdx ? '✓' : ''}
            </span>
            <span className={i <= currentIdx ? 'text-[#070A0E] font-medium' : 'text-[#8F9193]'}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <button
      onClick={onProcess}
      disabled={disabled}
      className="btn-primary w-full"
    >
      Process Contract
    </button>
  )
}
```

---

## Upload Page Orchestration (`app/upload/page.tsx`)

```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ContractTypeSelect } from '@/components/contract/contract-type-select'
import { ContractUploader } from '@/components/contract/contract-uploader'
import { TermPreviewCard } from '@/components/contract/term-preview-card'
import { CustomTermAdder } from '@/components/contract/custom-term-adder'
import { ProcessButton, UploadStep } from '@/components/contract/process-button'

export default function UploadPage() {
  const router = useRouter()
  const [contractType, setContractType] = useState<'nda' | 'msa' | null>(null)
  const [file, setFile]                 = useState<File | null>(null)
  const [customTerms, setCustomTerms]   = useState<string[]>([])
  const [step, setStep]                 = useState<UploadStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canProcess = !!contractType && !!file && step === 'idle'

  async function handleProcess() {
    if (!file || !contractType) return
    setStep('extracting')
    setErrorMessage(null)

    // Step 1: Upload + extract
    const fd = new FormData()
    fd.append('file', file)
    fd.append('contract_type', contractType)
    fd.append('custom_terms', JSON.stringify(customTerms))

    const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd })
    if (!uploadRes.ok) {
      const { error } = await uploadRes.json()
      setErrorMessage(error ?? 'Upload failed')
      setStep('error')
      return
    }
    const { contract_id } = await uploadRes.json()

    // Step 2: Extract key terms
    setStep('analysing')
    const processRes = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_id }),
    })
    if (!processRes.ok) {
      const { error } = await processRes.json()
      setErrorMessage(error ?? 'Analysis failed')
      setStep('error')
      return
    }

    setStep('done')
    router.push(`/results/${contract_id}`)
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* header */}
      <header className="bg-white border-b border-[#DADADB] px-8 py-4 flex items-center justify-between">
        <a href="/dashboard" className="text-lg font-bold text-[#070A0E]">
          Contract<span className="text-[#115ACB]">IQ</span>
        </a>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-[#070A0E] mb-1">Review a Contract</h1>
          <p className="text-sm text-[#4A4C4F]">
            Upload an NDA or MSA to extract key terms automatically.
          </p>
        </div>

        <ContractTypeSelect value={contractType} onChange={setContractType} disabled={step !== 'idle'} />
        <ContractUploader onFileSelected={setFile} disabled={step !== 'idle'} />

        {contractType && (
          <>
            <TermPreviewCard contractType={contractType} customTerms={customTerms} />
            <CustomTermAdder terms={customTerms} onAdd={t => setCustomTerms(p => [...p, t])} onRemove={i => setCustomTerms(p => p.filter((_, idx) => idx !== i))} maxTerms={5} />
          </>
        )}

        <ProcessButton
          step={step}
          onProcess={handleProcess}
          disabled={!canProcess}
          errorMessage={errorMessage}
          onRetry={() => setStep('idle')}
        />
      </main>
    </div>
  )
}
```

---

## Edge Cases

| Scenario | Handling |
|---|---|
| File > 10 MB | Client-side rejection before upload |
| Non-PDF file | Client-side rejection |
| Server-side page count > 20 | 400 response; client shows error in ProcessButton |
| Scanned PDF (< 100 words) | 422 response; "Scanned PDFs are not supported yet" |
| Token count > 15,000 | 422 response; clear message with token count |
| Storage upload fails | Non-blocking; `file_path` = null; AI pipeline unaffected |
| OpenAI fails during `/api/process` | Handled by Spec 03; `contracts.status = 'error'` |
| User navigates away during processing | Status remains 'processing' in DB; retry available from dashboard |
