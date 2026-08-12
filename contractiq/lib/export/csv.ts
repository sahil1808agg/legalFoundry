import type { KeyTerm } from '@/types/contract'

function escapeCell(value: string | number | boolean | null | undefined): string {
  const str = value == null ? '' : String(value)
  // RFC 4180: wrap in quotes if contains comma, quote, or newline
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function row(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(escapeCell).join(',')
}

export function buildCSV(terms: KeyTerm[], contractName: string): string {
  const header = row([
    'Term Name',
    'Value',
    'Page Number',
    'Confidence Score (%)',
    'Source Sentence',
    'Edited (Y/N)',
    'Original AI Value',
  ])

  const dataRows = terms.map(t =>
    row([
      t.term_name,
      t.value,
      t.page_number ?? '',
      Math.round(t.confidence_score * 100),
      t.source_sentence,
      t.is_edited ? 'Y' : 'N',
      t.original_value ?? '',
    ])
  )

  const metaRow = `# ContractIQ Export — ${contractName} — ${new Date().toISOString()}`

  return [metaRow, header, ...dataRows].join('\r\n')
}

export function downloadCSV(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
