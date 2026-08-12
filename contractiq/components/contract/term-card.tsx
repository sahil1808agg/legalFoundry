'use client'
import type { KeyTerm } from '@/types/contract'
import { ConfidenceBadge }   from './confidence-badge'
import { SourceTooltip }     from './source-tooltip'
import { TermInlineEditor }  from './term-inline-editor'

interface TermCardProps {
  term:        KeyTerm
  isEditing:   boolean
  onEditStart: (id: string) => void
  onSave:      (id: string, value: string) => void
  onCancel:    () => void
  onPageClick: (page: number) => void
}

export function TermCard({ term, isEditing, onEditStart, onSave, onCancel, onPageClick }: TermCardProps) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      {/* Header row: name + badges + page */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-sm font-medium text-[#070A0E]">{term.term_name}</span>
          {term.is_manual && (
            <span className="badge-violet text-[10px] shrink-0">Custom</span>
          )}
          {term.is_edited && !isEditing && (
            <div className="relative group inline-block shrink-0">
              <span className="badge-amber text-[10px] cursor-help">Edited</span>
              {term.original_value && (
                <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block z-20
                               w-56 rounded-md shadow-lg bg-[#070A0E] text-white text-xs px-3 py-2 pointer-events-none">
                  AI suggested: {term.original_value}
                  <div className="absolute top-full left-4 border-4 border-transparent border-t-[#070A0E]" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Confidence + page */}
        <div className="flex items-center gap-2 shrink-0">
          <ConfidenceBadge score={term.confidence_score} />
          {term.page_number && (
            <button
              type="button"
              onClick={() => onPageClick(term.page_number!)}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#E7EFFC] text-[#115ACB] border border-[#92B7F0] hover:bg-[#B6CFF5] transition-colors"
              title={`Go to page ${term.page_number}`}
            >
              p.{term.page_number}
            </button>
          )}
        </div>
      </div>

      {/* Value */}
      {isEditing ? (
        <TermInlineEditor
          currentValue={term.value}
          onSave={value => onSave(term.id, value)}
          onCancel={onCancel}
        />
      ) : (
        <button
          type="button"
          onClick={() => onEditStart(term.id)}
          className="text-left text-sm text-[#070A0E] hover:text-[#115ACB] transition-colors cursor-text w-full"
          title="Click to edit"
        >
          {term.value}
        </button>
      )}

      {/* Source sentence */}
      {!isEditing && term.source_sentence && (
        <SourceTooltip sourceSentence={term.source_sentence} />
      )}
    </div>
  )
}
