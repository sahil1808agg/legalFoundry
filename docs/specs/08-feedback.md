# Spec 08 — Feedback Rating Submission

**Stories:** US-010  
**Priority:** P2  
**Files touched:** `app/api/feedback/route.ts`, `components/contract/feedback-widget.tsx`

---

## What to Build

At the bottom of the results page, a thumbs-up / thumbs-down widget lets users rate the contract review quality. An optional comment textarea appears after a rating is selected. Submitting upserts a row into `user_feedback`. After submission, the widget shows "Thank you!" and the buttons are disabled. On page reload, the previously submitted rating is pre-filled from the API response.

---

## Acceptance Criteria

- [ ] Thumbs-up and thumbs-down buttons are shown in the results page footer
- [ ] Selecting a rating highlights the selected button (filled icon); other button remains outlined
- [ ] Comment textarea appears below the buttons after a rating is selected
- [ ] Comment max 1,000 characters; character counter shown
- [ ] Submitting without selecting a rating shows inline validation error
- [ ] Successful submission shows "Thank you for your feedback!" and disables both buttons
- [ ] On results page load, if feedback already exists for this contract, the widget shows the previous rating (pre-filled, buttons disabled)
- [ ] API returns 200 on success; 400 on invalid rating; 401 if unauthenticated
- [ ] Network error shows toast "Feedback could not be saved — please try again"

---

## Database

### Table Touched

**`user_feedback`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `contract_id` | uuid FK | |
| `user_id` | uuid FK | |
| `rating` | text CHECK IN ('up','down') | |
| `comment` | text nullable | Max 1,000 chars enforced at API layer |
| `created_at` | timestamptz | |

Unique constraint: `(contract_id, user_id)` — allows UPSERT to update an existing rating.

### DB Tasks

```sql
-- UPSERT — insert or update if already exists
INSERT INTO user_feedback (contract_id, user_id, rating, comment)
VALUES ($contract_id, $user_id, $rating, $comment)
ON CONFLICT (contract_id, user_id)
DO UPDATE SET
  rating  = EXCLUDED.rating,
  comment = EXCLUDED.comment
RETURNING id, rating, comment;
```

The `GET /api/contracts/[id]` response (Spec 04) already includes `feedback` (the user's existing rating + comment, or null). This is how the widget pre-fills on reload — no separate GET endpoint needed.

---

## `app/api/feedback/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { contract_id?: string; rating?: string; comment?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { contract_id, rating, comment } = body

  if (!contract_id) return NextResponse.json({ error: 'contract_id is required' }, { status: 400 })
  if (rating !== 'up' && rating !== 'down') {
    return NextResponse.json({ error: 'rating must be "up" or "down"' }, { status: 400 })
  }

  const trimmedComment = comment?.trim() ?? null
  if (trimmedComment && trimmedComment.length > 1000) {
    return NextResponse.json({ error: 'Comment must be 1,000 characters or fewer' }, { status: 400 })
  }

  // Verify contract ownership
  const { data: contract } = await supabase
    .from('contracts')
    .select('id')
    .eq('id', contract_id)
    .eq('user_id', user.id)
    .single()

  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  // Upsert feedback
  const { data: feedback, error: upsertError } = await supabase
    .from('user_feedback')
    .upsert(
      {
        contract_id,
        user_id: user.id,
        rating,
        comment: trimmedComment,
      },
      { onConflict: 'contract_id,user_id' }
    )
    .select('id, rating, comment')
    .single()

  if (upsertError || !feedback) {
    console.error('user_feedback upsert error:', upsertError)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
  }

  return NextResponse.json({ success: true, feedback })
}
```

---

## `components/contract/feedback-widget.tsx` — Full Implementation

```typescript
'use client'
import { useState } from 'react'

interface Props {
  contractId:      string
  initialRating:   'up' | 'down' | null
  initialComment:  string | null
}

export function FeedbackWidget({ contractId, initialRating, initialComment }: Props) {
  const alreadySubmitted = initialRating !== null

  const [rating, setRating]       = useState<'up' | 'down' | null>(initialRating)
  const [comment, setComment]     = useState(initialComment ?? '')
  const [submitted, setSubmitted] = useState(alreadySubmitted)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [validationErr, setValidationErr] = useState<string | null>(null)

  const MAX_COMMENT = 1000
  const charsLeft   = MAX_COMMENT - comment.length
  const overLimit   = charsLeft < 0

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
        <span className="text-lg">👍</span>
        <span>Thank you for your feedback!</span>
        <span className="text-[#4A4C4F] ml-1">
          ({rating === 'up' ? 'Helpful' : 'Not helpful'})
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-[#070A0E]">Was this review helpful?</p>

      {/* Rating buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => { setRating('up'); setValidationErr(null) }}
          disabled={loading}
          aria-label="Thumbs up"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
            rating === 'up'
              ? 'bg-[#E7F6E7] text-[#084406] border-[#92D490]'
              : 'bg-white text-[#4A4C4F] border-[#D1D5DB] hover:border-[#115ACB] hover:text-[#115ACB]'
          }`}
        >
          <ThumbsUp filled={rating === 'up'} />
          Helpful
        </button>

        <button
          onClick={() => { setRating('down'); setValidationErr(null) }}
          disabled={loading}
          aria-label="Thumbs down"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
            rating === 'down'
              ? 'bg-[#FAEBEB] text-[#581618] border-[#EAA2A3]'
              : 'bg-white text-[#4A4C4F] border-[#D1D5DB] hover:border-[#D13438] hover:text-[#D13438]'
          }`}
        >
          <ThumbsDown filled={rating === 'down'} />
          Not helpful
        </button>
      </div>

      {/* Comment textarea — shown after rating selected */}
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

      {/* Validation error */}
      {validationErr && (
        <p className="text-xs text-[#D13438]">{validationErr}</p>
      )}

      {/* API error */}
      {error && (
        <p className="text-sm text-[#D13438] bg-[#FAEBEB] border border-[#EAA2A3] rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || overLimit}
        className="btn-primary self-start text-sm"
      >
        {loading ? 'Submitting…' : 'Submit feedback'}
      </button>
    </div>
  )
}

function ThumbsUp({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
    </svg>
  )
}

function ThumbsDown({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-4 h-4 rotate-180" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
    </svg>
  ) : (
    <svg className="w-4 h-4 rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
    </svg>
  )
}
```

---

## Results Page Integration

The `GET /api/contracts/[id]` response (Spec 04) includes:

```typescript
feedback: {
  rating:  'up' | 'down' | null,
  comment: string | null,
} | null
```

In `app/results/[id]/page.tsx`, pass this to `ResultsClient`, which renders `FeedbackWidget` in the page footer:

```typescript
<FeedbackWidget
  contractId={contract.id}
  initialRating={feedback?.rating ?? null}
  initialComment={feedback?.comment ?? null}
/>
```

---

## Design Notes

| Element | Style |
|---|---|
| Section label | `text-sm font-medium text-[#070A0E]` |
| Thumbs up (selected) | `bg-[#E7F6E7] text-[#084406] border-[#92D490]` Green 50/700/200 |
| Thumbs down (selected) | `bg-[#FAEBEB] text-[#581618] border-[#EAA2A3]` Red 50/900/200 |
| Unselected buttons | White bg, Grey border; hover colour matches their selection state |
| Comment textarea | `input-base resize-none` — matches form inputs throughout the app |
| Character counter | Grey 500 normally; Red 500 when over limit |
| Submit button | `btn-primary self-start` |
| Success state | Green tick text; simplified confirmation message with rating label |
| Widget placement | Results page footer, above the disclaimer / legal note |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Submit without selecting rating | Inline validation error "Please select a rating before submitting." |
| Comment > 1,000 chars | Counter turns red; Submit button disabled; server also validates |
| API error on submit | Error banner shown in widget; buttons remain enabled for retry |
| Already submitted (page reload) | `initialRating` non-null → `submitted=true` on mount → shows "Thank you!" immediately |
| User changes rating after submitting | Buttons are disabled after submission; no re-submission possible in MVP |
| `onConflict` upsert (second submission) | DB updates existing row; not reachable from UI (buttons disabled after first submit) |
| `contract_id` not found / wrong user | API returns 404; error shown in widget |
| Comment is empty on submit | `null` is stored (not empty string) — `comment?.trim() || null` in route |
