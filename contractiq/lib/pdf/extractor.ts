export interface ExtractionResult {
  text: string
  pageCount: number
}

// pdfjs-dist (used internally by pdf-parse) references DOMMatrix at import
// time. DOMMatrix is a browser DOM API not available in Node.js / serverless.
// This polyfill must run before pdf-parse is required.
function polyfillDOMAPIs() {
  const g = globalThis as Record<string, unknown>

  if (!g.DOMMatrix) {
    class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
      is2D = true
      isIdentity = true

      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init
          this.isIdentity =
            this.a === 1 && this.b === 0 && this.c === 0 &&
            this.d === 1 && this.e === 0 && this.f === 0
        }
      }

      multiply(other: DOMMatrix): DOMMatrix {
        const r = new DOMMatrix()
        r.a = this.a * other.a + this.c * other.b
        r.b = this.b * other.a + this.d * other.b
        r.c = this.a * other.c + this.c * other.d
        r.d = this.b * other.c + this.d * other.d
        r.e = this.a * other.e + this.c * other.f + this.e
        r.f = this.b * other.e + this.d * other.f + this.f
        return r
      }

      translate(tx = 0, ty = 0): DOMMatrix {
        return this.multiply(new DOMMatrix([1, 0, 0, 1, tx, ty]))
      }

      scale(sx = 1, sy = sx): DOMMatrix {
        return this.multiply(new DOMMatrix([sx, 0, 0, sy, 0, 0]))
      }

      inverse(): DOMMatrix {
        const det = this.a * this.d - this.b * this.c
        if (Math.abs(det) < 1e-10) return new DOMMatrix()
        const r = new DOMMatrix()
        r.a =  this.d / det
        r.b = -this.b / det
        r.c = -this.c / det
        r.d =  this.a / det
        r.e = (this.c * this.f - this.d * this.e) / det
        r.f = (this.b * this.e - this.a * this.f) / det
        return r
      }

      transformPoint(p: { x: number; y: number }) {
        return {
          x: this.a * p.x + this.c * p.y + this.e,
          y: this.b * p.x + this.d * p.y + this.f,
          z: 0,
          w: 1,
        }
      }

      toString() {
        return `matrix(${this.a},${this.b},${this.c},${this.d},${this.e},${this.f})`
      }
    }
    g.DOMMatrix = DOMMatrix
  }

  if (!g.DOMPoint) {
    g.DOMPoint = class DOMPoint {
      constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
      static fromPoint(p: { x?: number; y?: number; z?: number; w?: number }) {
        return new (g.DOMPoint as new (x: number, y: number, z: number, w: number) => unknown)(
          p.x ?? 0, p.y ?? 0, p.z ?? 0, p.w ?? 1
        )
      }
      matrixTransform(m: { transformPoint: (p: { x: number; y: number }) => { x: number; y: number } }) {
        return m.transformPoint(this)
      }
    }
  }

  if (!g.Path2D) {
    g.Path2D = class Path2D {
      moveTo() {}; lineTo() {}; closePath() {}
      rect() {}; arc() {}; bezierCurveTo() {}
    }
  }
}

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<ExtractionResult> {
  polyfillDOMAPIs()

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse')

  let pageNumber = 0
  const pageTexts: string[] = []

  const pagerender = async (pageData: { getTextContent: () => Promise<{ items: unknown[] }> }) => {
    const textContent = await pageData.getTextContent()
    const text = textContent.items
      .map((item) =>
        typeof item === 'object' && item !== null && 'str' in item
          ? (item as { str: string }).str
          : ''
      )
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
