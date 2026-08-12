'use client'
import { useState, useCallback } from 'react'
import type { KeyTerm } from '@/types/contract'

interface UseContractOptions {
  initialTerms: KeyTerm[]
}

export function useContract({ initialTerms }: UseContractOptions) {
  const [terms, setTerms]               = useState<KeyTerm[]>(initialTerms)
  const [editingTermId, setEditingTermId] = useState<string | null>(null)
  const [editError, setEditError]         = useState<string | null>(null)

  const startEdit = useCallback((id: string) => {
    setEditingTermId(id)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingTermId(null)
  }, [])

  const saveTerm = useCallback(async (termId: string, newValue: string) => {
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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Save failed')
      }

      const updated: KeyTerm = await res.json()
      setTerms(prev => prev.map(t => t.id === termId ? { ...t, ...updated } : t))
    } catch (err) {
      // Revert optimistic update
      setTerms(prev => prev.map(t => t.id === termId ? previous : t))
      setEditError(err instanceof Error ? err.message : 'Failed to save — please try again.')
    }
  }, [terms])

  const clearEditError = useCallback(() => setEditError(null), [])

  return { terms, editingTermId, editError, startEdit, cancelEdit, saveTerm, clearEditError }
}
