'use client'
import { useEffect, useRef, useState } from 'react'

interface PDFViewerProps {
  signedUrl:  string
  targetPage: number
}

export function PDFViewer({ signedUrl, targetPage }: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [numPages, setNumPages] = useState(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPDF() {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        const pdf = await pdfjsLib.getDocument(signedUrl).promise
        if (cancelled) return
        pdfRef.current = pdf
        setNumPages(pdf.numPages)

        if (!containerRef.current) return

        // Render pages sequentially
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break
          await renderPage(pdfjsLib, pdf, pageNum, containerRef.current)
        }

        setLoading(false)
      } catch (err) {
        console.error('PDF load error:', err)
        if (!cancelled) setError(true)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function renderPage(pdfjsLib: any, pdf: any, pageNum: number, container: HTMLDivElement) {
      const page  = await pdf.getPage(pageNum)
      const scale = 1.2
      const vp    = page.getViewport({ scale })

      const wrapper = document.createElement('div')
      wrapper.id    = `pdf-page-${pageNum}`
      wrapper.style.cssText = `margin-bottom: 8px; position: relative;`

      const canvas          = document.createElement('canvas')
      canvas.width          = Math.floor(vp.width)
      canvas.height         = Math.floor(vp.height)
      canvas.style.cssText  = `display:block; width:100%; border-radius:4px; box-shadow:0 1px 4px rgba(0,0,0,0.08);`

      wrapper.appendChild(canvas)
      container.appendChild(wrapper)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport: vp }).promise
    }

    loadPDF()
    return () => { cancelled = true }
  }, [signedUrl])

  // Scroll to target page
  useEffect(() => {
    if (targetPage < 1 || loading) return
    const el = document.getElementById(`pdf-page-${targetPage}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.outline = '2px solid #115ACB'
      el.style.borderRadius = '4px'
      setTimeout(() => { el.style.outline = '' }, 1500)
    }
  }, [targetPage, loading])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-center">
        <p className="text-sm text-[#4A4C4F]">Unable to render PDF.</p>
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary text-sm"
        >
          Download PDF
        </a>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-y-auto bg-[#F0F0F1] p-3">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#F0F0F1]">
          <div className="flex flex-col items-center gap-2">
            <span className="w-6 h-6 border-2 border-[#115ACB] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[#4A4C4F]">Loading PDF…</span>
          </div>
        </div>
      )}
      {numPages > 0 && (
        <div className="sticky top-2 left-0 z-10 flex justify-center mb-2 pointer-events-none">
          <span className="bg-[#070A0E]/80 text-white text-xs px-3 py-1 rounded-full">
            {numPages} pages
          </span>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
