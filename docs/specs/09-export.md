# Spec 09 — Export Key Terms (CSV + PDF)

**Stories:** US-011  
**Priority:** P2  
**Files touched:** `components/contract/export-button.tsx`, `lib/export/csv.ts`, `lib/export/pdf.ts`

---

## What to Build

An "Export" dropdown button on the results page lets users download the extracted key terms as either a CSV file or a formatted PDF report. Both exports are generated entirely client-side from the in-memory `key_terms` array — no API route is needed. The export fires within 5 seconds even for 20-page contracts.

---

## Acceptance Criteria

- [ ] "Export" dropdown shows two options: "Export CSV" and "Export PDF"
- [ ] CSV download triggers immediately (no loading state needed)
- [ ] PDF download generates within 5 seconds
- [ ] Export button is disabled when `key_terms` is empty (e.g., status='error')
- [ ] CSV columns: Term Name, Value, Page Number, Confidence %, Source Sentence, Edited (Y/N), Custom (Y/N)
- [ ] CSV values with commas or quotes are properly escaped (RFC 4180)
- [ ] PDF includes: ContractIQ header, contract file name + date, term table (same columns as CSV)
- [ ] Downloaded file names: `[contract-file-name]-key-terms.csv` and `[contract-file-name]-key-terms.pdf`

---

## No API Route

All export logic runs in the browser. The `key_terms` array is already available in the results page via `useContract` hook state. No server round-trip is required.

---

## `lib/export/csv.ts` — CSV Generation

```typescript
export interface ExportableTerm {
  term_name:        string
  value:            string
  page_number:      number | null
  confidence_score: number
  source_sentence:  string
  is_edited:        boolean
  is_manual:        boolean
}

function escapeCSV(value: string): string {
  // RFC 4180: wrap in quotes if contains comma, quote, or newline
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function exportToCSV(terms: ExportableTerm[], fileName: string): void {
  const headers = [
    'Term Name',
    'Value',
    'Page Number',
    'Confidence %',
    'Source Sentence',
    'Edited',
    'Custom',
  ]

  const rows = terms.map(t => [
    escapeCSV(t.term_name),
    escapeCSV(t.value),
    t.page_number?.toString() ?? '',
    `${Math.round(t.confidence_score * 100)}%`,
    escapeCSV(t.source_sentence),
    t.is_edited  ? 'Y' : 'N',
    t.is_manual  ? 'Y' : 'N',
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.join(',')),
  ].join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `${sanitizeFileName(fileName)}-key-terms.csv`)
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function sanitizeFileName(name: string): string {
  // Remove extension and replace non-alphanumeric with hyphens
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
}
```

---

## `lib/export/pdf.ts` — PDF Generation with `@react-pdf/renderer`

```typescript
import {
  Document, Page, Text, View, StyleSheet, pdf, Font
} from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ExportableTerm } from './csv'

const styles = StyleSheet.create({
  page:       { padding: 40, fontFamily: 'Helvetica', fontSize: 9, color: '#070A0E' },
  header:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  logo:       { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#115ACB' },
  meta:       { fontSize: 8, color: '#4A4C4F' },
  title:      { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  subtitle:   { fontSize: 9, color: '#4A4C4F', marginBottom: 16 },
  tableHead:  { flexDirection: 'row', backgroundColor: '#F4F6F8', padding: '6 4', borderBottom: '1 solid #E5E7EB' },
  tableRow:   { flexDirection: 'row', padding: '5 4', borderBottom: '1 solid #F4F6F8' },
  colName:    { width: '15%', fontFamily: 'Helvetica-Bold' },
  colValue:   { width: '22%' },
  colPage:    { width: '7%', textAlign: 'center' },
  colConf:    { width: '10%', textAlign: 'center' },
  colSource:  { width: '36%', color: '#4A4C4F' },
  colEdited:  { width: '5%', textAlign: 'center' },
  colCustom:  { width: '5%', textAlign: 'center' },
  footer:     { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7, color: '#4A4C4F', textAlign: 'center' },
})

function ContractPDF({
  terms,
  fileName,
  contractType,
  generatedAt,
}: {
  terms:        ExportableTerm[]
  fileName:     string
  contractType: string
  generatedAt:  string
}) {
  return createElement(Document, null,
    createElement(Page, { size: 'A4', style: styles.page, wrap: true },
      // Header
      createElement(View, { style: styles.header },
        createElement(Text, { style: styles.logo }, 'ContractIQ'),
        createElement(Text, { style: styles.meta }, `Generated ${generatedAt}`)
      ),
      // Title block
      createElement(Text, { style: styles.title }, fileName),
      createElement(Text, { style: styles.subtitle }, `Contract type: ${contractType.toUpperCase()} · ${terms.length} terms extracted`),
      // Table header
      createElement(View, { style: styles.tableHead },
        createElement(Text, { style: styles.colName },   'Term'),
        createElement(Text, { style: styles.colValue },  'Value'),
        createElement(Text, { style: styles.colPage },   'Page'),
        createElement(Text, { style: styles.colConf },   'Conf.'),
        createElement(Text, { style: styles.colSource }, 'Source'),
        createElement(Text, { style: styles.colEdited }, 'Ed.'),
        createElement(Text, { style: styles.colCustom }, 'Cust.'),
      ),
      // Rows
      ...terms.map((t, i) =>
        createElement(View, { key: i, style: styles.tableRow, wrap: false },
          createElement(Text, { style: styles.colName },   t.term_name),
          createElement(Text, { style: styles.colValue },  t.value),
          createElement(Text, { style: styles.colPage },   t.page_number?.toString() ?? '—'),
          createElement(Text, { style: styles.colConf },   `${Math.round(t.confidence_score * 100)}%`),
          createElement(Text, { style: styles.colSource }, t.source_sentence),
          createElement(Text, { style: styles.colEdited }, t.is_edited  ? 'Y' : ''),
          createElement(Text, { style: styles.colCustom }, t.is_manual  ? 'Y' : ''),
        )
      ),
      // Footer
      createElement(Text, { style: styles.footer, fixed: true },
        'ContractIQ — This document is for informational purposes only and does not constitute legal advice.'
      )
    )
  )
}

export async function exportToPDF(
  terms:        ExportableTerm[],
  fileName:     string,
  contractType: string,
): Promise<void> {
  const { triggerDownload, sanitizeFileName } = await import('./csv')
  const generatedAt = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  const doc  = createElement(ContractPDF, { terms, fileName, contractType, generatedAt })
  const blob = await pdf(doc as any).toBlob()

  triggerDownload(blob, `${sanitizeFileName(fileName)}-key-terms.pdf`)
}
```

**Note:** `triggerDownload` and `sanitizeFileName` from `csv.ts` need to be exported (not internal). Update `csv.ts` to export them, or move shared helpers to `lib/export/utils.ts`.

---

## `components/contract/export-button.tsx` — Full Implementation

```typescript
'use client'
import { useState, useRef, useEffect } from 'react'
import { exportToCSV } from '@/lib/export/csv'
import type { ExportableTerm } from '@/lib/export/csv'

interface Props {
  terms:        ExportableTerm[]
  fileName:     string
  contractType: string
}

export function ExportButton({ terms, fileName, contractType }: Props) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState<'csv' | 'pdf' | null>(null)
  const dropdownRef            = useRef<HTMLDivElement>(null)
  const disabled               = terms.length === 0

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleCSV() {
    setOpen(false)
    exportToCSV(terms, fileName)
  }

  async function handlePDF() {
    setOpen(false)
    setLoading('pdf')
    try {
      const { exportToPDF } = await import('@/lib/export/pdf')
      await exportToPDF(terms, fileName, contractType)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled || loading !== null}
        className="btn-secondary flex items-center gap-1.5 text-sm"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {loading === 'pdf' ? 'Generating PDF…' : 'Export'}
        {!loading && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-md shadow-lg bg-white border border-[#E5E7EB] z-20 py-1">
          <button
            onClick={handleCSV}
            className="w-full text-left px-4 py-2 text-sm text-[#070A0E] hover:bg-[#F4F6F8]"
          >
            Export CSV
          </button>
          <button
            onClick={handlePDF}
            className="w-full text-left px-4 py-2 text-sm text-[#070A0E] hover:bg-[#F4F6F8]"
          >
            Export PDF
          </button>
        </div>
      )}
    </div>
  )
}
```

---

## `package.json` Addition

```json
"@react-pdf/renderer": "^3.4.4"
```

Install with: `npm install @react-pdf/renderer`

`@react-pdf/renderer` is a client-side-only package. If Next.js server-side imports cause an error, add to `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias.canvas = false
    return config
  },
}
module.exports = nextConfig
```

---

## Design Notes

| Element | Style |
|---|---|
| Export button | `btn-secondary` — outlined, Grey 900 text; dropdown chevron |
| Export button (disabled) | `disabled:opacity-40 disabled:cursor-not-allowed` |
| Loading state | Button text changes to "Generating PDF…"; no spinner needed (PDF generation is fast) |
| Dropdown | White bg, `border-[#E5E7EB]`, `shadow-lg`, `rounded-md`; closes on outside click |
| Dropdown items | `text-sm text-[#070A0E]`; `hover:bg-[#F4F6F8]`; full-width, left-aligned |
| PDF font | Helvetica (built into `@react-pdf/renderer`; no custom font needed for MVP) |
| PDF brand colour | `#115ACB` Blue 500 for the "ContractIQ" logo text |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| `terms.length === 0` (e.g., status='error') | Export button `disabled` — dropdown never opens |
| Very long source sentence in CSV | RFC 4180 quoting handles commas/newlines; no truncation |
| Very long source sentence in PDF | `@react-pdf` wraps text within column width; `wrap: false` on row keeps term on one page |
| Browser blocks download popup | Most browsers allow `<a download>` clicks from user-initiated events — this is always user-triggered |
| `@react-pdf` crashes (malformed content) | `handlePDF` catch block: `setLoading(null)` silently; consider adding a toast for the error |
| PDF generation > 5 s | Unlikely for ≤ 20 terms; dynamic import means `@react-pdf` JS loads on first click, not page load |
| File name contains special characters | `sanitizeFileName()` strips all non-alphanumeric chars and replaces with hyphens |
| `confidence_score` is 0 | Displayed as "0%" — valid; not hidden |
