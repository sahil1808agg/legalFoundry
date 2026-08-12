'use client'
import { useState, useRef, useEffect } from 'react'
import type { KeyTerm } from '@/types/contract'
import { buildCSV, downloadCSV } from '@/lib/export/csv'

interface ExportButtonProps {
  terms:        KeyTerm[]
  contractName: string
  disabled?:    boolean
}

export function ExportButton({ terms, contractName, disabled }: ExportButtonProps) {
  const [open, setOpen]           = useState(false)
  const [exporting, setExporting] = useState(false)
  const menuRef                   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleCSV() {
    setOpen(false)
    const csv = buildCSV(terms, contractName)
    downloadCSV(csv, `${contractName.replace(/\s+/g, '-')}-key-terms.csv`)
  }

  async function handlePDF() {
    setOpen(false)
    setExporting(true)
    try {
      const { exportKeyTermsPDF } = await import('@/lib/export/pdf')
      await exportKeyTermsPDF(terms, contractName)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const isDisabled = disabled || terms.length === 0 || exporting

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        disabled={isDisabled}
        className="btn-secondary text-sm flex items-center gap-1.5"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {exporting ? (
          <span className="w-3.5 h-3.5 border-2 border-[#4A4C4F] border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        Export
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#DADADB] rounded-md shadow-lg z-20 overflow-hidden">
          <button
            type="button"
            onClick={handleCSV}
            className="w-full text-left px-4 py-2.5 text-sm text-[#070A0E] hover:bg-[#FAFAFA] flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 5h6M4 7.5h6M4 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Export CSV
          </button>
          <button
            type="button"
            onClick={handlePDF}
            className="w-full text-left px-4 py-2.5 text-sm text-[#070A0E] hover:bg-[#FAFAFA] flex items-center gap-2 border-t border-[#F0F0F1]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 5h3M4 7.5h6M4 10h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Export PDF
          </button>
        </div>
      )}
    </div>
  )
}
