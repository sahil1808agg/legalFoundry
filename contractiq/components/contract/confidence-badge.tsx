interface ConfidenceBadgeProps {
  score: number | null
}

export function ConfidenceBadge({ score }: ConfidenceBadgeProps) {
  const pct = score !== null ? Math.round(score * 100) : 0
  const low = (score ?? 0) < 0.5

  let badgeClass: string
  if ((score ?? 0) >= 0.8) {
    badgeClass = 'bg-[#E7F6E7] text-[#084406] border border-[#92D490]'
  } else if ((score ?? 0) >= 0.5) {
    badgeClass = 'bg-[#FFF9F0] text-[#854D00] border border-[#FFE3BD]'
  } else {
    badgeClass = 'bg-[#FAEBEB] text-[#581618] border border-[#EAA2A3]'
  }

  return (
    <div className="relative inline-flex items-center gap-1">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
        {pct}%
      </span>
      {low && <LowConfidenceWarning />}
    </div>
  )
}

function LowConfidenceWarning() {
  return (
    <div className="relative group">
      <span
        className="text-[#D13438] text-sm cursor-help leading-none"
        aria-label="Low confidence warning"
      >
        ⚠
      </span>
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20
                   w-56 rounded-md shadow-lg bg-[#070A0E] text-white text-xs px-3 py-2 whitespace-normal text-center pointer-events-none"
        role="tooltip"
      >
        Low confidence — we recommend verifying this in the document directly.
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#070A0E]" />
      </div>
    </div>
  )
}
