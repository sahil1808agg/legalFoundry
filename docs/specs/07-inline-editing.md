# Spec 07 — Inline Key Term Editing

**Stories:** US-009  
**Priority:** P1  
**Files touched:** `app/api/terms/[id]/route.ts`, `components/contract/term-inline-editor.tsx`, `hooks/use-contract.ts`

---

## What to Build

Any key term value on the results page can be edited inline. Clicking a value switches the `TermCard` into edit mode (text input pre-filled with the current value). Saving sends a `PATCH /api/terms/[id]` request that updates `key_terms.value`, sets `is_edited = true`, stores `original_value` (on the first edit only), and logs a row to `term_corrections`. An "Edited" badge appears on the term card after a successful save. Optimistic update means the UI reflects the change immediately — it reverts if the server returns an error.

---

## Acceptance Criteria

- [ ] Clicking a term value text switches that card to edit mode
- [ ] Only one term is in edit mode at a time
- [ ] Save button sends `PATCH /api/terms/[id]` with `{ value: string }`
- [ ] Optimistic update: UI shows new value before server confirms
- [ ] On server error, UI reverts to previous value and shows an error toast
- [ ] "Edited" badge appears on saved terms; hovering it shows tooltip with original AI value
- [ ] `original_value` in `key_terms` is set only on the first edit — subsequent edits do not overwrite it
- [ ] Every save logs a row to `term_corrections` (original → corrected)
- [ ] Saving an empty string shows inline validation error and does not call the API
- [ ] Cancel button restores the previous value without making an API call
- [ ] P95 save latency ≤ 2 seconds

---

## Database

### Tables Touched

**`key_terms`** — UPDATE

| Column | Change |
|---|---|
| `value` | Updated to the new value |
| `is_edited` | Set to `true` |
| `original_value` | Set to previous `value` **only if `original_value IS NULL`** (first edit) |

**`term_corrections`** — INSERT (audit log)

| Column | Value |
|---|---|
| `key_term_id` | The ID of the `key_terms` row |
| `user_id` | Authenticated user ID |
| `original_value` | The value before this specific edit |
| `corrected_value` | The new value submitted |

### DB Tasks

```sql
-- 1. Fetch the term to verify ownership and current value
SELECT id, value, is_edited, original_value, user_id
FROM key_terms
WHERE id = $term_id AND user_id = $user_id;

-- 2. Update the term (preserve original_value on first edit only)
UPDATE key_terms
SET
  value         = $new_value,
  is_edited     = true,
  original_value = CASE WHEN original_value IS NULL THEN $old_value ELSE original_value END
WHERE id = $term_id AND user_id = $user_id
RETURNING id, value, is_edited, original_value;

-- 3. Log the correction
INSERT INTO term_corrections (key_term_id, user_id, original_value, corrected_value)
VALUES ($term_id, $user_id, $old_value, $new_value);
```

Both the UPDATE and the INSERT must succeed. If the INSERT fails, the API returns 500 but the UPDATE is **not** rolled back (the value was saved; only the audit log is missing — acceptable for MVP).

---

## `app/api/terms/[id]/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const term_id = params.id
  if (!term_id) return NextResponse.json({ error: 'term_id is required' }, { status: 400 })

  let body: { value?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const newValue = body.value?.trim()
  if (!newValue) return NextResponse.json({ error: 'value cannot be empty' }, { status: 400 })

  // Fetch and verify ownership
  const { data: term } = await supabase
    .from('key_terms')
    .select('id, value, is_edited, original_value')
    .eq('id', term_id)
    .eq('user_id', user.id)
    .single()

  if (!term) return NextResponse.json({ error: 'Term not found' }, { status: 404 })

  const previousValue = term.value

  // Update term
  const { data: updated, error: updateError } = await supabase
    .from('key_terms')
    .update({
      value:          newValue,
      is_edited:      true,
      // Only set original_value on the very first edit
      ...(term.original_value === null ? { original_value: previousValue } : {}),
    })
    .eq('id', term_id)
    .eq('user_id', user.id)
    .select('id, term_name, value, is_edited, original_value, page_number, confidence_score, source_sentence, is_manual')
    .single()

  if (updateError || !updated) {
    console.error('key_terms update error:', updateError)
    return NextResponse.json({ error: 'Failed to save changes' }, { status: 500 })
  }

  // Log correction
  const { error: logError } = await supabase.from('term_corrections').insert({
    key_term_id:     term_id,
    user_id:         user.id,
    original_value:  previousValue,
    corrected_value: newValue,
  })

  if (logError) {
    console.error('term_corrections insert error:', logError)
    // Non-fatal — value was saved; audit log failure does not block response
  }

  return NextResponse.json(updated)
}
```

---

## State Management — `useContract` Hook (editing slice)

The full `useContract` hook manages the key terms array. The editing slice adds:

```typescript
// Inside useContract hook
const [editingTermId, setEditingTermId] = useState<string | null>(null)

async function saveTermEdit(termId: string, newValue: string) {
  // Capture previous value for rollback
  const previous = terms.find(t => t.id === termId)
  if (!previous) return

  // Optimistic update
  setTerms(prev => prev.map(t =>
    t.id === termId ? { ...t, value: newValue, is_edited: true } : t
  ))
  setEditingTermId(null)

  try {
    const res = await fetch(`/api/terms/${termId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ value: newValue }),
    })

    if (!res.ok) throw new Error('Save failed')

    const updated = await res.json()
    // Sync with server response (includes original_value)
    setTerms(prev => prev.map(t => t.id === termId ? { ...t, ...updated } : t))
  } catch {
    // Revert optimistic update
    setTerms(prev => prev.map(t => t.id === termId ? previous : t))
    // Signal error to UI — expose via hook return
    setEditError('Failed to save — please try again.')
  }
}

function cancelEdit() {
  setEditingTermId(null)
}
```

---

## `components/contract/term-inline-editor.tsx` — Full Implementation

```typescript
'use client'
import { useState, useRef, useEffect } from 'react'

interface TermInlineEditorProps {
  currentValue: string
  onSave:       (value: string) => void
  onCancel:     () => void
}

export function TermInlineEditor({ currentValue, onSave, onCancel }: TermInlineEditorProps) {
  const [value, setValue] = useState(currentValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef          = useRef<HTMLInputElement>(null)

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
      />
      {error && (
        <p className="text-xs text-[#D13438]">{error}</p>
      )}
      <div className="flex gap-2">
        <button onClick={handleSave}   className="btn-primary text-xs px-3 py-1">Save</button>
        <button onClick={onCancel}     className="btn-ghost text-xs px-3 py-1">Cancel</button>
      </div>
    </div>
  )
}
```

---

## Updated `term-card.tsx` — Edit Mode Integration

The `TermCard` from Spec 04 is updated to support edit mode:

```typescript
// Inside TermCard component (additions to existing Spec 04 implementation):

interface TermCardProps {
  term:          KeyTerm
  isEditing:     boolean
  onEditStart:   (id: string) => void
  onSave:        (id: string, value: string) => void
  onCancel:      () => void
}

// In the value display section:
{isEditing ? (
  <TermInlineEditor
    currentValue={term.value}
    onSave={value => onSave(term.id, value)}
    onCancel={onCancel}
  />
) : (
  <button
    onClick={() => onEditStart(term.id)}
    className="text-left text-sm text-[#070A0E] hover:text-[#115ACB] transition-colors cursor-text w-full"
    title="Click to edit"
  >
    {term.value}
  </button>
)}

// "Edited" badge (shown when is_edited = true and not currently editing):
{term.is_edited && !isEditing && (
  <div className="relative group inline-block">
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#FFF9F0] text-[#854D00] border border-[#FFE3BD]">
      Edited
    </span>
    {/* Tooltip with original AI value */}
    <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 w-64 rounded-md shadow-lg bg-[#070A0E] text-white text-xs px-3 py-2">
      AI suggested: {term.original_value ?? '—'}
    </div>
  </div>
)}
```

---

## Error Toast

When `saveTermEdit()` fails, it sets `editError` in the hook. The `ResultsClient` renders:

```typescript
// components/contract/edit-error-toast.tsx
'use client'
import { useEffect } from 'react'

interface Props {
  message: string | null
  onDismiss: () => void
}

export function EditErrorToast({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-md bg-[#FAEBEB] border border-[#EAA2A3] px-4 py-3 shadow-lg text-sm text-[#581618] flex items-center gap-2">
      <span>{message}</span>
      <button onClick={onDismiss} className="font-medium hover:underline">Dismiss</button>
    </div>
  )
}
```

---

## Design Notes

| Element | Style |
|---|---|
| Value text (display) | `text-[#070A0E]`; hover `text-[#115ACB]`; `cursor-text` signals editability |
| Edit input | `input-base` — same as form inputs; auto-focus + select-all on open |
| Save button | `btn-primary text-xs` — Blue 500 |
| Cancel button | `btn-ghost text-xs` — no background |
| "Edited" badge | Amber: `bg-[#FFF9F0]` `text-[#854D00]` `border-[#FFE3BD]` |
| Tooltip (original value) | Dark `bg-[#070A0E]` Grey 900, white text, `group-hover:block` |
| Validation error text | `text-[#D13438]` Red 500, `text-xs` |
| Error toast | `bg-[#FAEBEB]` Red 50 with auto-dismiss after 4 s |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Save with empty string | `TermInlineEditor` shows inline error; API call is not made |
| Network error on PATCH | Optimistic update reverted; error toast shown for 4 s |
| Second edit of same term | `original_value` already set (not NULL); server-side CASE preserves the first AI value |
| User cancels without saving | State unchanged; `setEditingTermId(null)` |
| Two terms clicked rapidly | `setEditingTermId(newId)` closes previous editor before opening next (only one active at a time) |
| `term_corrections` INSERT fails | Logged to console; PATCH still returns 200 with updated term (audit log is non-fatal) |
| Term ID not found / wrong user | Server returns 404; client shows error toast |
| `is_edited = true` from a previous session | "Edited" badge shown immediately on page load; `original_value` shown in tooltip |
