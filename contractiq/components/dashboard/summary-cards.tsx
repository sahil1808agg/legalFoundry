interface SummaryCardsProps {
  total:    number
  ndaCount: number
  msaCount: number
}

export function SummaryCards({ total, ndaCount, msaCount }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
      <div className="card p-5">
        <p className="text-sm text-[#4A4C4F] font-medium">Total Contracts Reviewed</p>
        <p className="text-3xl font-bold text-[#070A0E] mt-1">{total}</p>
      </div>
      <div className="card p-5">
        <p className="text-sm text-[#4A4C4F] font-medium">By Type</p>
        <div className="flex gap-6 mt-2">
          <div>
            <span className="text-2xl font-bold text-[#070A0E]">{ndaCount}</span>
            <span className="text-sm text-[#4A4C4F] ml-1.5">NDA</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-[#070A0E]">{msaCount}</span>
            <span className="text-sm text-[#4A4C4F] ml-1.5">MSA</span>
          </div>
        </div>
      </div>
    </div>
  )
}
