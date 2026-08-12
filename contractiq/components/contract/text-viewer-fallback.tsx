'use client'
import { useEffect, useRef, useMemo } from 'react'

interface TextViewerFallbackProps {
  contractText: string
  targetPage:   number
}

interface PageBlock {
  pageNum: number
  text:    string
}

function parsePages(contractText: string): PageBlock[] {
  const parts  = contractText.split(/\[PAGE (\d+)\]/g)
  const blocks: PageBlock[] = []

  for (let i = 1; i < parts.length; i += 2) {
    const pageNum = parseInt(parts[i], 10)
    const text    = (parts[i + 1] ?? '').trim()
    blocks.push({ pageNum, text })
  }

  return blocks.length > 0 ? blocks : [{ pageNum: 1, text: contractText }]
}

export function TextViewerFallback({ contractText, targetPage }: TextViewerFallbackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pages        = useMemo(() => parsePages(contractText), [contractText])

  useEffect(() => {
    if (targetPage < 1) return
    const el = document.getElementById(`text-page-${targetPage}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('ring-2', 'ring-[#115ACB]')
      setTimeout(() => el.classList.remove('ring-2', 'ring-[#115ACB]'), 1500)
    }
  }, [targetPage])

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto bg-white px-6 py-4 font-mono text-sm text-[#070A0E] leading-relaxed"
    >
      <div className="mb-3 px-2 py-1 bg-[#FFF9F0] border border-[#FFE3BD] rounded text-xs text-[#854D00]">
        PDF viewer unavailable — showing extracted text
      </div>
      {pages.map(({ pageNum, text }) => (
        <div
          key={pageNum}
          id={`text-page-${pageNum}`}
          className="mb-6 rounded-md transition-all duration-300"
        >
          <div className="sticky top-0 bg-[#FAFAFA] border-b border-[#F0F0F1] px-2 py-1 mb-2 text-xs font-medium text-[#4A4C4F] z-10">
            Page {pageNum}
          </div>
          <p className="px-2 whitespace-pre-wrap break-words">{text}</p>
        </div>
      ))}
    </div>
  )
}
