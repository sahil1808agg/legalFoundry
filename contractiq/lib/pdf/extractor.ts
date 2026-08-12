export interface ExtractionResult {
  text: string
  pageCount: number
}

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<ExtractionResult> {
  // pdf-parse is a pure-JS CJS module — no worker threads, works in all serverless environments
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse')

  let pageNumber = 0
  const pageTexts: string[] = []

  const pagerender = async (pageData: { getTextContent: () => Promise<{ items: unknown[] }> }) => {
    const textContent = await pageData.getTextContent()
    const text = textContent.items
      .map((item) => (typeof item === 'object' && item !== null && 'str' in item ? (item as { str: string }).str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pageNumber++
    pageTexts.push(`[PAGE ${pageNumber}]\n${text}`)
    return `[PAGE ${pageNumber}]\n${text}`
  }

  const result = await pdfParse(Buffer.from(buffer), { pagerender })

  return {
    text: pageTexts.length > 0 ? pageTexts.join('\n\n') : result.text,
    pageCount: result.numpages,
  }
}
