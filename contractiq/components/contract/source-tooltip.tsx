'use client'
import { useState } from 'react'

interface SourceTooltipProps {
  sourceSentence: string
}

export function SourceTooltip({ sourceSentence }: SourceTooltipProps) {
  const [expanded, setExpanded] = useState(false)

  if (!sourceSentence) return null

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="text-xs text-[#115ACB] hover:underline focus:outline-none"
      >
        {expanded ? 'Hide source ▲' : 'Why? ▼'}
      </button>
      {expanded && (
        <blockquote className="mt-2 pl-3 border-l-2 border-[#DADADB] text-xs text-[#4A4C4F] italic leading-relaxed">
          "{sourceSentence}"
        </blockquote>
      )}
    </div>
  )
}
