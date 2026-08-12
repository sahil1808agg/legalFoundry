'use client'
import type { KeyTerm } from '@/types/contract'
import { useContract }  from '@/hooks/use-contract'
import { TermCard }     from './term-card'

interface KeyTermsPanelProps {
  initialTerms: KeyTerm[]
  onPageClick:  (page: number) => void
  onEditError:  (msg: string) => void
}

export function KeyTermsPanel({ initialTerms, onPageClick, onEditError }: KeyTermsPanelProps) {
  const { terms, editingTermId, editError, startEdit, cancelEdit, saveTerm, clearEditError } =
    useContract({ initialTerms })

  if (editError) {
    onEditError(editError)
    clearEditError()
  }

  if (terms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-[#4A4C4F]">No key terms extracted yet.</p>
      </div>
    )
  }

  const standardTerms = terms.filter(t => !t.is_manual)
  const customTerms   = terms.filter(t => t.is_manual)

  return (
    <div className="flex flex-col gap-3">
      {standardTerms.length > 0 && (
        <section>
          <p className="text-xs font-medium text-[#4A4C4F] uppercase tracking-wide mb-2">
            Standard Terms
          </p>
          <div className="flex flex-col gap-2">
            {standardTerms.map(term => (
              <TermCard
                key={term.id}
                term={term}
                isEditing={editingTermId === term.id}
                onEditStart={startEdit}
                onSave={saveTerm}
                onCancel={cancelEdit}
                onPageClick={onPageClick}
              />
            ))}
          </div>
        </section>
      )}

      {customTerms.length > 0 && (
        <section className="mt-2">
          <p className="text-xs font-medium text-[#4A4C4F] uppercase tracking-wide mb-2">
            Custom Terms
          </p>
          <div className="flex flex-col gap-2">
            {customTerms.map(term => (
              <TermCard
                key={term.id}
                term={term}
                isEditing={editingTermId === term.id}
                onEditStart={startEdit}
                onSave={saveTerm}
                onCancel={cancelEdit}
                onPageClick={onPageClick}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
