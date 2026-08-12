// Server-side PDF text extraction using pdfjs-dist
// Returns the full text with [PAGE N] markers inserted between pages

export interface ExtractionResult {
  text: string
  pageCount: number
}

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  // Disable worker thread — required for serverless (Netlify Functions / Lambda)
  pdfjsLib.GlobalWorkerOptions.workerSrc = ''

  const loadingTask = pdfjsLib.getDocument({
    data:            new Uint8Array(buffer),
    useSystemFonts:  true,
    isEvalSupported: false,
  })
  const pdf = await loadingTask.promise

  const pageCount = pdf.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pageTexts.push(`[PAGE ${i}]\n${pageText}`)
  }

  return {
    text: pageTexts.join('\n\n'),
    pageCount,
  }
}
