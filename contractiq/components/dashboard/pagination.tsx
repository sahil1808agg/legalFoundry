interface PaginationProps {
  page:   number
  total:  number
  limit:  number
  onPage: (n: number) => void
}

export function Pagination({ page, total, limit, onPage }: PaginationProps) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  const start = (page - 1) * limit + 1
  const end   = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between py-3 px-4 border-t border-[#F0F0F1] text-sm text-[#4A4C4F]">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
