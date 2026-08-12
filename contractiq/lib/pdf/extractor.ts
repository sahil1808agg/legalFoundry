export interface ExtractionResult {
  text: string
  pageCount: number
}

interface PDFPage {
  Texts: Array<{ R: Array<{ T: string }> }>
}

interface PDFOutput {
  Pages: PDFPage[]
}

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<ExtractionResult> {
  // pdf2json: pure JS PDF parser, zero DOM dependencies — works in all serverless envs.
  // It is a default CJS export so we use require().
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json')

  return new Promise((resolve, reject) => {
    const parser = new PDFParser()

    parser.on('pdfParser_dataError', (err: unknown) => {
      const msg =
        err instanceof Error
          ? err
          : typeof err === 'object' && err !== null && 'parserError' in err
            ? (err as { parserError: Error }).parserError
            : new Error(String(err))
      reject(msg)
    })

    parser.on('pdfParser_dataReady', (data: PDFOutput) => {
      const pages = data.Pages ?? []

      const pageTexts = pages.map((page, i) => {
        const text = (page.Texts ?? [])
          .map(t =>
            (t.R ?? [])
              .map(r => { try { return decodeURIComponent(r.T) } catch { return r.T } })
              .join('')
          )
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        return `[PAGE ${i + 1}]\n${text}`
      })

      resolve({
        text:      pageTexts.join('\n\n'),
        pageCount: pages.length,
      })
    })

    parser.parseBuffer(Buffer.from(buffer))
  })
}
