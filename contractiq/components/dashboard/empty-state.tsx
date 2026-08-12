import Link from 'next/link'

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 mb-4 rounded-full bg-[#E7EFFC] flex items-center justify-center">
        <svg className="w-8 h-8 text-[#115ACB]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-[#070A0E] mb-1">No contracts yet</h3>
      <p className="text-sm text-[#4A4C4F] mb-6 max-w-xs">
        Upload your first NDA or MSA to get instant AI-powered key term extraction.
      </p>
      <Link href="/upload" className="btn-primary">
        Upload your first contract
      </Link>
    </div>
  )
}
