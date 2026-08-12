'use client'
import { useState, useRef, useCallback } from 'react'

const MAX_SIZE_MB = 10
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

interface Props {
  file:     File | null
  onChange: (file: File | null) => void
}

export function ContractUploader({ file, onChange }: Props) {
  const [dragActive, setDragActive] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const inputRef                    = useRef<HTMLInputElement>(null)

  const validate = useCallback((f: File): string | null => {
    if (f.type !== 'application/pdf') return 'Only PDF files are accepted.'
    if (f.size > MAX_SIZE_BYTES) return `File exceeds the ${MAX_SIZE_MB} MB limit.`
    return null
  }, [])

  function handleFile(f: File) {
    const err = validate(f)
    if (err) {
      setError(err)
      onChange(null)
      return
    }
    setError(null)
    onChange(f)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave() {
    setDragActive(false)
  }

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-[#070A0E]">PDF file</label>

      {file ? (
        <div className="flex items-center justify-between rounded-md border border-[#92D490] bg-[#E7F6E7] px-4 py-3">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-[#084406] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[#084406] truncate max-w-[200px]">{file.name}</p>
              <p className="text-xs text-[#084406]/70">{formatSize(file.size)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { onChange(null); setError(null) }}
            className="text-xs text-[#084406] hover:underline ml-4"
          >
            Remove
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-10 cursor-pointer transition-colors duration-100 ${
            dragActive
              ? 'border-[#115ACB] bg-[#E7EFFC]'
              : 'border-[#DADADB] bg-white hover:border-[#8F9193] hover:bg-[#FAFAFA]'
          }`}
        >
          <svg className="w-10 h-10 text-[#C1C2C3] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-sm font-medium text-[#070A0E] mb-1">
            Drop your PDF here, or{' '}
            <span className="text-[#115ACB]">browse</span>
          </p>
          <p className="text-xs text-[#4A4C4F]">PDF only · Max {MAX_SIZE_MB} MB</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleChange}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-[#D13438]">{error}</p>
      )}
    </div>
  )
}
