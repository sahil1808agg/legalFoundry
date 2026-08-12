'use client'
import { useState } from 'react'

const MAX_CUSTOM_TERMS = 5

interface Props {
  terms:    string[]
  onChange: (terms: string[]) => void
}

export function CustomTermAdder({ terms, onChange }: Props) {
  const [input, setInput] = useState('')
  const atLimit = terms.length >= MAX_CUSTOM_TERMS

  function handleAdd() {
    const trimmed = input.trim()
    if (!trimmed || atLimit) return
    if (terms.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      setInput('')
      return
    }
    onChange([...terms, trimmed])
    setInput('')
  }

  function handleRemove(term: string) {
    onChange(terms.filter(t => t !== term))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#070A0E]">
          Custom terms{' '}
          <span className="text-[#4A4C4F] font-normal">
            ({terms.length}/{MAX_CUSTOM_TERMS})
          </span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={atLimit ? 'Maximum 5 custom terms reached' : 'e.g. Non-compete radius'}
            disabled={atLimit}
            className="input-base flex-1"
            maxLength={100}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={atLimit || !input.trim()}
            className="btn-secondary px-4 whitespace-nowrap disabled:opacity-40"
          >
            + Add
          </button>
        </div>
        {atLimit && (
          <p className="text-xs text-[#854D00]">
            Maximum {MAX_CUSTOM_TERMS} custom terms reached.
          </p>
        )}
      </div>

      {terms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {terms.map(term => (
            <span
              key={term}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#F7F0FF] text-[#380070] border border-[#E3C7FF]"
            >
              {term}
              <button
                type="button"
                onClick={() => handleRemove(term)}
                aria-label={`Remove ${term}`}
                className="ml-0.5 text-[#7F00FF] hover:text-[#380070] focus:outline-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
