# Spec 04 — Results Page: PDF Viewer, Key Terms Panel & Confidence Display

**Stories:** US-003, US-004, US-006  
**Priority:** P0 (confidence + page attribution), P1 (PDF viewer)  
**Files touched:** `app/results/[id]/page.tsx`, `app/api/contracts/[id]/route.ts`, `components/contract/pdf-viewer.tsx`, `components/contract/text-viewer-fallback.tsx`, `components/contract/key-terms-panel.tsx`, `components/contract/term-card.tsx`, `components/contract/confidence-badge.tsx`, `components/contract/source-tooltip.tsx`, `components/ui/disclaimer-banner.tsx`

---

## What to Build

A two-panel results page: left panel is an interactive PDF viewer (PDF.js) or text fallback; right panel is a scrollable key terms list. Clicking a term's page badge scrolls the viewer to that page. Confidence scores are colour-coded; low-confidence terms show a non-dismissible warning.

---

## Acceptance Criteria

- [ ] Results page loads contract + key terms in a single `GET /api/contracts/[id]` call
- [ ] Left panel renders the PDF viewer when `signed_url` is present; silently renders text fallback when null
- [ ] Right panel shows all extracted terms with: Term Name, Value, Page (clickable), Confidence badge
- [ ] Clicking a page badge scrolls the viewer to that page (smooth scroll)
- [ ] Green badge for confidence ≥ 80%; amber for 50–79%; red + ⚠️ for < 50%
- [ ] ⚠️ tooltip is non-dismissible; text: "Low confidence — we recommend verifying this in the document directly."
- [ ] "Why?" link expands the `source_sentence` for every term
- [ ] "Not legal advice" disclaimer visible on every results page (not behind a scroll)
- [ ] Custom terms show a "Custom" badge (violet/indigo)

---

## `app/api/contracts/[id]/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch contract
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, file_name, contract_type, contract_text, file_path, status, page_count, created_at')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Update last_accessed_at (non-blocking)
  supabase.from('contracts').update({ last_accessed_at: new Date().toISOString() }).eq('id', params.id).then(() => {})

  // Fetch key terms
  const { data: key_terms } = await supabase
    .from('key_terms')
    .select('*')
    .eq('contract_id', params.id)
    .order('is_manual', { ascending: true })
    .order('term_name', { ascending: true })

  // Generate signed URL (1-hour expiry)
  let signed_url: string | null = null
  if (contract.file_path) {
    const { data: signed } = await supabase.storage
      .from('contracts')
      .createSignedUrl(contract.file_path, 3600)
    signed_url = signed?.signedUrl ?? null
  }

  // Fetch chat session + messages
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('contract_id', params.id)
    .eq('user_id', user.id)
    .single()

  let messages: unknown[] = []
  if (session) {
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true })
      .limit(200)
    messages = msgs ?? []
  }

  // Fetch existing feedback
  const { data: feedback } = await supabase
    .from('user_feedback')
    .select('rating, comment')
    .eq('contract_id', params.id)
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    contract:  { ...contract, contract_text: contract.contract_text },
    key_terms: key_terms ?? [],
    signed_url,
    chat_session: {
      session_id: session?.id ?? null,
      messages,
    },
    feedback: feedback ?? null,
  })
}
```

---

## `components/contract/confidence-badge.tsx` — Full Implementation

```typescript
interface Props {
  score: number | null
}

type Level = 'high' | 'medium' | 'low'

function getLevel(score: number | null): Level {
  const s = score ?? 0
  if (s >= 0.80) return 'high'
  if (s >= 0.50) return 'medium'
  return 'low'
}

const STYLES: Record<Level, string> = {
  high:   'bg-[#E7F6E7] text-[#084406] border border-[#92D490]',
  medium: 'bg-[#FFF9F0] text-[#854D00] border border-[#FFE3BD]',
  low:    'bg-[#FAEBEB] text-[#581618] border border-[#EAA2A3]',
}

export function ConfidenceBadge({ score }: Props) {
  const s     = score ?? 0
  const level = getLevel(score)
  const pct   = Math.round(Math.min(1, Math.max(0, s)) * 100)

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STYLES[level]}`}>
        {pct}%
      </span>
      {level === 'low' && (
        <span
          title="Low confidence — we recommend verifying this in the document directly."
          className="cursor-help text-[#D13438] text-sm select-none"
          aria-label="Low confidence warning"
        >
          ⚠️
        </span>
      )}
    </span>
  )
}
```

---

## `components/contract/source-tooltip.tsx`

```typescript
'use client'
import { useState } from 'react'

interface Props {
  sourceSentence: string
}

export function SourceTooltip({ sourceSentence }: Props) {
  const [open, setOpen] = useState(false)
  if (!sourceSentence) return null

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-[#4A4C4F] hover:text-[#115ACB] underline"
        type="button"
      >
        {open ? 'Hide source ↑' : 'Why? ↓'}
      </button>
      {open && (
        <blockquote className="mt-2 pl-3 border-l-2 border-[#DADADB] text-xs text-[#4A4C4F] italic leading-relaxed">
          {sourceSentence}
        </blockquote>
      )}
    </div>
  )
}
```

---

## `components/contract/term-card.tsx`

```typescript
import { ConfidenceBadge } from './confidence-badge'
import { SourceTooltip } from './source-tooltip'
import type { KeyTerm } from '@/types/contract'

interface Props {
  term:         KeyTerm
  onPageClick:  (page: number) => void
}

export function TermCard({ term, onPageClick }: Props) {
  return (
    <div className="flex flex-col gap-1 py-3 px-4 border-b border-[#F0F0F1] last:border-b-0">
      {/* Header row: term name + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-[#070A0E]">{term.term_name}</span>
        {term.is_manual && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#F7F0FF] text-[#380070] border border-[#E3C7FF]">
            Custom
          </span>
        )}
        {term.is_edited && (
          <span
            title={`AI suggested: ${term.original_value}`}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#FFF9F0] text-[#854D00] border border-[#FFE3BD] cursor-help"
          >
            Edited
          </span>
        )}
      </div>

      {/* Value row */}
      <p className="text-sm text-[#070A0E] leading-relaxed">{term.value}</p>

      {/* Meta row: page + confidence */}
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        {term.page_number != null && (
          <button
            onClick={() => onPageClick(term.page_number!)}
            className="text-xs text-[#115ACB] hover:underline font-mono"
            type="button"
          >
            p.{term.page_number}
          </button>
        )}
        <ConfidenceBadge score={term.confidence_score} />
      </div>

      <SourceTooltip sourceSentence={term.source_sentence} />
    </div>
  )
}
```

---

## `components/contract/key-terms-panel.tsx`

```typescript
import { TermCard } from './term-card'
import type { KeyTerm } from '@/types/contract'

interface Props {
  terms:       KeyTerm[]
  onPageClick: (page: number) => void
}

export function KeyTermsPanel({ terms, onPageClick }: Props) {
  if (terms.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[#4A4C4F]">
        No terms extracted yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-[#F0F0F1] flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#070A0E]">Key Terms ({terms.length})</h2>
      </div>
      <div className="overflow-auto">
        {terms.map(term => (
          <TermCard key={term.id} term={term} onPageClick={onPageClick} />
        ))}
      </div>
    </div>
  )
}
```

---

## `components/contract/pdf-viewer.tsx` — Full Implementation

```typescript
'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  signedUrl:  string
  targetPage: number | null
}

export function PDFViewer({ signedUrl, targetPage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError]   = useState(false)
  const [pageCount, setPageCount]   = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const pdfDocRef = useRef<unknown>(null)

  useEffect(() => {
    if (!signedUrl) return
    let cancelled = false

    async function loadPDF() {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        // Set worker source — must match installed version
        if (typeof window !== 'undefined') {
          const { GlobalWorkerOptions } = pdfjsLib
          GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.mjs',
            import.meta.url,
          ).toString()
        }

        const pdf = await pdfjsLib.getDocument(signedUrl).promise
        if (cancelled) return
        pdfDocRef.current = pdf
        setPageCount(pdf.numPages)
        await renderPage(pdf, 1)
      } catch (err) {
        if (!cancelled) { console.error('PDF load error:', err); setLoadError(true) }
      }
    }

    loadPDF()
    return () => { cancelled = true }
  }, [signedUrl])

  useEffect(() => {
    if (targetPage != null && pdfDocRef.current) {
      const clamped = Math.max(1, Math.min(targetPage, (pageCount ?? 1)))
      setCurrentPage(clamped)
      renderPage(pdfDocRef.current as Parameters<typeof renderPage>[0], clamped)
      highlightContainer()
    }
  }, [targetPage])

  async function renderPage(pdf: { getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number }; render: (ctx: unknown) => { promise: Promise<void> } }> }, pageNum: number) {
    if (!containerRef.current) return
    const page     = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas   = document.createElement('canvas')
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(canvas)
  }

  function highlightContainer() {
    if (!containerRef.current) return
    containerRef.current.classList.add('ring-2', 'ring-[#115ACB]')
    setTimeout(() => containerRef.current?.classList.remove('ring-2', 'ring-[#115ACB]'), 1500)
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-[#4A4C4F]">
        <p>Could not render this PDF.</p>
        <a href={signedUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
          Download PDF
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#F0F0F1] text-xs text-[#4A4C4F]">
        <span>{pageCount ? `Page ${currentPage} of ${pageCount}` : 'Loading…'}</span>
        <div className="flex gap-2">
          <button onClick={() => { if (currentPage > 1) { const p = currentPage - 1; setCurrentPage(p); renderPage(pdfDocRef.current as Parameters<typeof renderPage>[0], p) }}} className="btn-ghost px-2 py-1 text-xs">‹</button>
          <button onClick={() => { if (pageCount && currentPage < pageCount) { const p = currentPage + 1; setCurrentPage(p); renderPage(pdfDocRef.current as Parameters<typeof renderPage>[0], p) }}} className="btn-ghost px-2 py-1 text-xs">›</button>
        </div>
      </div>
      {/* Canvas */}
      <div className="flex-1 overflow-auto bg-[#F0F0F1] flex items-start justify-center p-4 transition-all duration-300">
        <div ref={containerRef} className="shadow-lg rounded transition-all duration-300" />
      </div>
    </div>
  )
}
```

---

## `components/contract/text-viewer-fallback.tsx`

```typescript
'use client'
import { useEffect, useMemo } from 'react'

interface Props {
  contractText: string
  targetPage:   number | null
}

interface PageSection {
  pageNum: number
  content: string
}

export function TextViewerFallback({ contractText, targetPage }: Props) {
  const pages = useMemo<PageSection[]>(() => {
    const sections: PageSection[] = []
    const chunks = contractText.split(/\[PAGE (\d+)\]/g)
    for (let i = 1; i < chunks.length; i += 2) {
      const pageNum = parseInt(chunks[i], 10)
      const content = chunks[i + 1]?.trim() ?? ''
      sections.push({ pageNum, content })
    }
    return sections
  }, [contractText])

  useEffect(() => {
    if (targetPage == null) return
    const el = document.getElementById(`page-${targetPage}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.add('bg-[#FFF9F0]')
    setTimeout(() => el.classList.remove('bg-[#FFF9F0]'), 1500)
  }, [targetPage])

  return (
    <div className="flex flex-col gap-6 p-6 overflow-auto bg-white text-sm text-[#070A0E] font-mono leading-relaxed">
      {pages.map(({ pageNum, content }) => (
        <section
          key={pageNum}
          id={`page-${pageNum}`}
          className="flex flex-col gap-2 transition-colors duration-500 rounded p-2"
        >
          <p className="text-xs text-[#4A4C4F] text-center">— Page {pageNum} —</p>
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </section>
      ))}
    </div>
  )
}
```

---

## `app/results/[id]/page.tsx` — Full Implementation

```typescript
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ResultsClient } from './results-client'

export default async function ResultsPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/contracts/${params.id}`, {
    headers: { Cookie: '' }, // will be handled by server client
    cache: 'no-store',
  })

  // Better: call the DB directly from the server component
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  // Fetch all data server-side
  const [contractRes, keyTermsRes, sessionRes] = await Promise.all([
    supabase.from('contracts').select('*').eq('id', params.id).eq('user_id', user.id).single(),
    supabase.from('key_terms').select('*').eq('contract_id', params.id).order('is_manual').order('term_name'),
    supabase.from('chat_sessions').select('id').eq('contract_id', params.id).eq('user_id', user.id).single(),
  ])

  if (!contractRes.data) return notFound()

  let messages: unknown[] = []
  if (sessionRes.data) {
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionRes.data.id)
      .order('created_at', { ascending: true })
      .limit(200)
    messages = msgs ?? []
  }

  let signedUrl: string | null = null
  if (contractRes.data.file_path) {
    const { data: signed } = await supabase.storage
      .from('contracts')
      .createSignedUrl(contractRes.data.file_path, 3600)
    signedUrl = signed?.signedUrl ?? null
  }

  const { data: feedback } = await supabase
    .from('user_feedback')
    .select('rating, comment')
    .eq('contract_id', params.id)
    .eq('user_id', user.id)
    .single()

  return (
    <ResultsClient
      contract={contractRes.data}
      keyTerms={keyTermsRes.data ?? []}
      signedUrl={signedUrl}
      initialSession={{ session_id: sessionRes.data?.id ?? null, messages }}
      initialFeedback={feedback ?? null}
    />
  )
}
```

`ResultsClient` is a client component (in `app/results/[id]/results-client.tsx`) that manages `targetPage` state and renders the two-panel layout.

---

## Design Notes

| Element | Token | Value |
|---|---|---|
| Page background | Grey 25 | `#FAFAFA` |
| Panel background | White | `#FFFFFF` |
| Panel divider | Grey 50 | `#F0F0F1` |
| Term name | Grey 900 | `#070A0E` |
| Metadata (page, secondary) | Grey 500 | `#4A4C4F` |
| Page badge (clickable) | Blue 500 | `#115ACB` |
| "Custom" badge | Violet 50 bg, Violet 900 text | `#F7F0FF` / `#380070` |
| "Edited" badge | Yellow 50 bg, Yellow 900 text | `#FFF9F0` / `#854D00` |
| Source blockquote border | Grey 100 | `#DADADB` |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| `signed_url` is null | `TextViewerFallback` renders silently; no error shown |
| `signed_url` expires mid-session | PDF.js fetch fails; "Download PDF" fallback link shown |
| `page_number` is null | Page badge not rendered; no click action |
| `page_number` out of range | Clamp to 1..pageCount in viewer |
| No key terms (status='error') | KeyTermsPanel shows empty state message |
| contract.status = 'processing' | Show loading skeleton; poll every 3 seconds until 'completed' or 'error' |
