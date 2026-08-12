'use client'
import { useState, useRef, useEffect } from 'react'

interface TermInlineEditorProps {
  currentValue: string
  onSave:       (value: string) => void
  onCancel:     () => void
}

export function TermInlineEditor({ currentValue, onSave, onCancel }: TermInlineEditorProps) {
  const [value, setValue]   = useState(currentValue)
  const [error, setError]   = useState<string | null>(null)
  const inputRef            = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Value cannot be empty.')
      return
    }
    setError(null)
    onSave(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')  handleSave()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => { setValue(e.target.value); setError(null) }}
        onKeyDown={handleKeyDown}
        className="input-base text-sm"
        aria-label="Edit term value"
      />
      {error && (
        <p className="text-xs text-[#D13438]">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="btn-primary text-xs px-3 py-1"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost text-xs px-3 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
