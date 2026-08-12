'use client'
import { useState } from 'react'

interface FeedbackWidgetProps {
  contractId:     string
  initialRating:  'up' | 'down' | null
  initialComment: string | null
}

export function FeedbackWidget({ contractId, initialRating, initialComment }: FeedbackWidgetProps) {
  const alreadySubmitted = initialRating !== null

  const [rating, setRating]         = useState<'up' | 'down' | null>(initialRating)
  const [comment, setComment]       = useState(initialComment ?? '')
  const [submitted, setSubmitted]   = useState(alreadySubmitted)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [validationErr, setValidationErr] = useState<string | null>(null)

  const MAX_CHARS = 1000
  const charsLeft = MAX_CHARS - comment.length
  const overLimit = charsLeft < 0

  async function handleSubmit() {
    if (!rating) {
      setValidationErr('Please select a rating before submitting.')
      return
    }
    if (overLimit) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/feedback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contract_id: contractId, rating, comment: comment.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Submission failed')
      }
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feedback could not be saved — please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#084406]">
        <span>✓</span>
        <span>Thank you for your feedback!</span>
        <span className="text-[#4A4C4F] ml-1">({rating === 'up' ? 'Helpful' : 'Not helpful'})</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-[#070A0E]">Was this review helpful?</p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => { setRating('up'); setValidationErr(null) }}
          disabled={loading}
          aria-label="Thumbs up — helpful"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors duration-100 ${
            rating === 'up'
              ? 'bg-[#E7F6E7] text-[#084406] border-[#92D490]'
              : 'bg-white text-[#4A4C4F] border-[#DADADB] hover:border-[#8F9193]'
          }`}
        >
          👍 Helpful
        </button>
        <button
          type="button"
          onClick={() => { setRating('down'); setValidationErr(null) }}
          disabled={loading}
          aria-label="Thumbs down — not helpful"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors duration-100 ${
            rating === 'down'
              ? 'bg-[#FAEBEB] text-[#581618] border-[#EAA2A3]'
              : 'bg-white text-[#4A4C4F] border-[#DADADB] hover:border-[#8F9193]'
          }`}
        >
          👎 Not helpful
        </button>
      </div>

      {rating && (
        <div className="flex flex-col gap-1">
          <textarea
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="What could be improved? (optional)"
            className="input-base resize-none text-sm"
            disabled={loading}
          />
          <p className={`text-xs ${overLimit ? 'text-[#D13438]' : 'text-[#4A4C4F]'}`}>
            {charsLeft} characters remaining
          </p>
        </div>
      )}

      {validationErr && <p className="text-xs text-[#D13438]">{validationErr}</p>}
      {error && (
        <p className="text-sm text-[#D13438] bg-[#FAEBEB] border border-[#EAA2A3] rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || overLimit}
        className="btn-primary self-start text-sm"
      >
        {loading ? 'Submitting…' : 'Submit feedback'}
      </button>
    </div>
  )
}
