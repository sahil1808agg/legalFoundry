# Spec 06 — Dashboard with Contract History

**Stories:** US-008  
**Priority:** P1  
**Files touched:** `app/api/dashboard/route.ts`, `app/dashboard/page.tsx`, `components/dashboard/dashboard-table.tsx`, `components/dashboard/summary-cards.tsx`, `components/dashboard/empty-state.tsx`

---

## What to Build

The authenticated dashboard shows a 2-card summary (total contracts reviewed; breakdown by NDA / MSA) and a sortable, paginated table of the user's contracts. Clicking any row navigates to that contract's results page. When no contracts exist, an empty state with a CTA is shown instead of an empty table.

---

## Acceptance Criteria

- [ ] Dashboard loads contract list within 2 seconds for up to 100 contracts
- [ ] Summary cards show correct total count and per-type counts
- [ ] Table columns: File Name, Type, Status, Pages, Created At — all sortable
- [ ] Clicking a column header toggles ASC / DESC for that column
- [ ] Clicking a contract row navigates to `/results/[id]`
- [ ] When `total === 0`, empty state renders (no table)
- [ ] Contract with `status='error'` shows "Failed" badge + Retry link in row
- [ ] File names longer than 40 characters are truncated with `…`; full name visible on hover
- [ ] Page size is 20; pagination controls shown when `total > 20`
- [ ] Dashboard updates `last_accessed_at` on the contract when user clicks through to results (handled in `GET /api/contracts/[id]`, not here)

---

## Database

### Tables Used

**`contracts`** — read-only in this flow.

Selected columns: `id`, `file_name`, `contract_type`, `status`, `page_count`, `created_at`

### DB Tasks

```sql
-- Summary counts
SELECT
  COUNT(*)                                       AS total,
  COUNT(*) FILTER (WHERE contract_type = 'nda') AS nda_count,
  COUNT(*) FILTER (WHERE contract_type = 'msa') AS msa_count
FROM contracts
WHERE user_id = $user_id;

-- Paginated list
SELECT id, file_name, contract_type, status, page_count, created_at
FROM contracts
WHERE user_id = $user_id
ORDER BY $sort_column $sort_dir
LIMIT 20 OFFSET $offset;
```

The sort column and direction are validated server-side to prevent SQL injection — only allowlisted column names are accepted.

---

## `app/api/dashboard/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_SORT_COLUMNS = ['created_at', 'file_name', 'contract_type', 'status', 'page_count'] as const
type SortColumn = typeof ALLOWED_SORT_COLUMNS[number]

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = request.nextUrl
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit    = 20
  const offset   = (page - 1) * limit
  const rawSort  = searchParams.get('sort_by') ?? 'created_at'
  const sortDir  = searchParams.get('sort_dir') === 'asc' ? true : false  // true = ascending

  const sortBy: SortColumn = ALLOWED_SORT_COLUMNS.includes(rawSort as SortColumn)
    ? rawSort as SortColumn
    : 'created_at'

  // Paginated list
  const { data: contracts, error: listError } = await supabase
    .from('contracts')
    .select('id, file_name, contract_type, status, page_count, created_at')
    .eq('user_id', user.id)
    .order(sortBy, { ascending: sortDir })
    .range(offset, offset + limit - 1)

  if (listError) {
    console.error('Dashboard list error:', listError)
    return NextResponse.json({ error: 'Failed to load contracts' }, { status: 500 })
  }

  // Summary counts — separate query for accuracy even when paginated
  const { count: total } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const { count: ndaCount } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('contract_type', 'nda')

  const { count: msaCount } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('contract_type', 'msa')

  return NextResponse.json({
    contracts:  contracts ?? [],
    total:      total ?? 0,
    nda_count:  ndaCount ?? 0,
    msa_count:  msaCount ?? 0,
    page,
    limit,
    sort_by:    sortBy,
    sort_dir:   sortDir ? 'asc' : 'desc',
  })
}
```

---

## `app/dashboard/page.tsx` — Server Component

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardClient } from '@/components/dashboard/dashboard-client'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  // Server-side first load (page 1, default sort)
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/dashboard`, {
    headers: { Cookie: '' },  // supabase server client handles auth via cookies
    cache: 'no-store',
  })

  // Simpler: fetch directly from Supabase in the server component
  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, file_name, contract_type, status, page_count, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const { count: total }    = await supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
  const { count: ndaCount } = await supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('contract_type', 'nda')
  const { count: msaCount } = await supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('contract_type', 'msa')

  return (
    <DashboardClient
      initialContracts={contracts ?? []}
      initialTotal={total ?? 0}
      initialNdaCount={ndaCount ?? 0}
      initialMsaCount={msaCount ?? 0}
    />
  )
}
```

---

## State Management — `useDashboard` Hook

```typescript
// hooks/use-dashboard.ts
'use client'
import { useState, useCallback } from 'react'

export type SortColumn = 'created_at' | 'file_name' | 'contract_type' | 'status' | 'page_count'
export type SortDir    = 'asc' | 'desc'

export interface ContractRow {
  id:            string
  file_name:     string
  contract_type: 'nda' | 'msa'
  status:        'pending' | 'processing' | 'completed' | 'error'
  page_count:    number
  created_at:    string
}

interface UseDashboardOptions {
  initialContracts: ContractRow[]
  initialTotal:     number
}

export function useDashboard({ initialContracts, initialTotal }: UseDashboardOptions) {
  const [contracts, setContracts] = useState<ContractRow[]>(initialContracts)
  const [total, setTotal]         = useState(initialTotal)
  const [page, setPage]           = useState(1)
  const [sortBy, setSortBy]       = useState<SortColumn>('created_at')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const [loading, setLoading]     = useState(false)

  const fetch = useCallback(async (opts: {
    page?: number; sortBy?: SortColumn; sortDir?: SortDir
  } = {}) => {
    setLoading(true)
    const p  = opts.page    ?? page
    const sb = opts.sortBy  ?? sortBy
    const sd = opts.sortDir ?? sortDir
    try {
      const res  = await window.fetch(`/api/dashboard?page=${p}&sort_by=${sb}&sort_dir=${sd}`)
      const data = await res.json()
      setContracts(data.contracts)
      setTotal(data.total)
      setPage(p)
      setSortBy(sb)
      setSortDir(sd)
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, sortDir])

  function handleSort(col: SortColumn) {
    const nextDir = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc'
    fetch({ page: 1, sortBy: col, sortDir: nextDir })
  }

  function handlePage(next: number) {
    fetch({ page: next })
  }

  return { contracts, total, page, sortBy, sortDir, loading, handleSort, handlePage }
}
```

---

## `components/dashboard/summary-cards.tsx`

```typescript
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
        <div className="flex gap-4 mt-2">
          <div>
            <span className="text-2xl font-bold text-[#070A0E]">{ndaCount}</span>
            <span className="text-sm text-[#4A4C4F] ml-1">NDA</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-[#070A0E]">{msaCount}</span>
            <span className="text-sm text-[#4A4C4F] ml-1">MSA</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## `components/dashboard/dashboard-table.tsx`

```typescript
'use client'
import Link from 'next/link'
import { type ContractRow, type SortColumn, type SortDir } from '@/hooks/use-dashboard'

const STATUS_STYLES: Record<string, string> = {
  completed:  'bg-[#E7F6E7] text-[#084406] border border-[#92D490]',
  processing: 'bg-[#FFF9F0] text-[#854D00] border border-[#FFE3BD]',
  pending:    'bg-[#F4F6F8] text-[#4A4C4F] border border-[#D1D5DB]',
  error:      'bg-[#FAEBEB] text-[#581618] border border-[#EAA2A3]',
}

const STATUS_LABELS: Record<string, string> = {
  completed:  'Completed',
  processing: 'Processing',
  pending:    'Pending',
  error:      'Failed',
}

interface Props {
  contracts: ContractRow[]
  sortBy:    SortColumn
  sortDir:   SortDir
  onSort:    (col: SortColumn) => void
}

export function DashboardTable({ contracts, sortBy, sortDir, onSort }: Props) {
  const COLUMNS: { key: SortColumn; label: string }[] = [
    { key: 'file_name',     label: 'File Name'  },
    { key: 'contract_type', label: 'Type'        },
    { key: 'status',        label: 'Status'      },
    { key: 'page_count',    label: 'Pages'       },
    { key: 'created_at',    label: 'Uploaded'    },
  ]

  function SortIcon({ col }: { col: SortColumn }) {
    if (sortBy !== col) return <span className="text-[#D1D5DB]">↕</span>
    return <span className="text-[#115ACB]">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function truncate(name: string, max = 40) {
    return name.length > max ? name.slice(0, max) + '…' : name
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#E5E7EB]">
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="text-left py-3 px-4 font-medium text-[#4A4C4F] cursor-pointer hover:text-[#070A0E] select-none"
              >
                {col.label} <SortIcon col={col.key} />
              </th>
            ))}
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {contracts.map(contract => (
            <tr
              key={contract.id}
              className="border-b border-[#F4F6F8] hover:bg-[#FAFAFA] cursor-pointer"
            >
              <td className="py-3 px-4 font-medium text-[#070A0E]">
                <Link href={`/results/${contract.id}`} className="block" title={contract.file_name}>
                  {truncate(contract.file_name)}
                </Link>
              </td>
              <td className="py-3 px-4 uppercase text-xs font-semibold text-[#4A4C4F]">
                {contract.contract_type}
              </td>
              <td className="py-3 px-4">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[contract.status] ?? STATUS_STYLES.pending}`}>
                  {STATUS_LABELS[contract.status] ?? contract.status}
                </span>
              </td>
              <td className="py-3 px-4 text-[#4A4C4F]">{contract.page_count}</td>
              <td className="py-3 px-4 text-[#4A4C4F]">{formatDate(contract.created_at)}</td>
              <td className="py-3 px-4 text-right">
                {contract.status === 'error' ? (
                  <Link
                    href={`/upload?retry=${contract.id}`}
                    className="text-xs font-medium text-[#115ACB] hover:underline"
                  >
                    Retry
                  </Link>
                ) : (
                  <Link
                    href={`/results/${contract.id}`}
                    className="text-xs font-medium text-[#115ACB] hover:underline"
                  >
                    View
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

---

## `components/dashboard/empty-state.tsx`

```typescript
import Link from 'next/link'

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 mb-4 rounded-full bg-[#EEF2FF] flex items-center justify-center">
        <svg className="w-8 h-8 text-[#115ACB]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
```

---

## Pagination Component

```typescript
// components/dashboard/pagination.tsx
interface PaginationProps {
  page:    number
  total:   number
  limit:   number
  onPage:  (n: number) => void
}

export function Pagination({ page, total, limit, onPage }: PaginationProps) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between mt-4 text-sm text-[#4A4C4F]">
      <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
      <div className="flex gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="btn-ghost disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="btn-ghost disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
```

---

## `components/dashboard/dashboard-client.tsx`

```typescript
'use client'
import { useDashboard, type ContractRow } from '@/hooks/use-dashboard'
import { SummaryCards }   from './summary-cards'
import { DashboardTable } from './dashboard-table'
import { EmptyState }     from './empty-state'
import { Pagination }     from './pagination'
import Link from 'next/link'

interface Props {
  initialContracts: ContractRow[]
  initialTotal:     number
  initialNdaCount:  number
  initialMsaCount:  number
}

export function DashboardClient({ initialContracts, initialTotal, initialNdaCount, initialMsaCount }: Props) {
  const { contracts, total, page, sortBy, sortDir, loading, handleSort, handlePage } = useDashboard({
    initialContracts,
    initialTotal,
  })

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#070A0E]">Dashboard</h1>
            <p className="text-sm text-[#4A4C4F] mt-0.5">Your contract review history</p>
          </div>
          <Link href="/upload" className="btn-primary">
            + Upload Contract
          </Link>
        </div>

        {/* Summary cards — always shown */}
        <SummaryCards total={initialTotal} ndaCount={initialNdaCount} msaCount={initialMsaCount} />

        {/* Table or empty state */}
        {total === 0 ? (
          <EmptyState />
        ) : (
          <div className="card p-0 overflow-hidden">
            {loading && (
              <div className="h-0.5 bg-[#115ACB] animate-pulse" />
            )}
            <DashboardTable
              contracts={contracts}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <div className="px-4 pb-4">
              <Pagination page={page} total={total} limit={20} onPage={handlePage} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## Design Notes

| Element | Style |
|---|---|
| Page background | `bg-[#FAFAFA]` Grey 25 |
| Summary card | `card` (white `#FFFFFF`, rounded-lg, shadow-sm, border) |
| Table container | `card p-0 overflow-hidden` — no inner padding; rows stretch edge-to-edge |
| Column headers | `text-[#4A4C4F]` Grey 500; clickable — hover `text-[#070A0E]` Grey 900 |
| Table rows | `hover:bg-[#FAFAFA]`; `cursor-pointer`; border-bottom `#F4F6F8` |
| Status badges | Traffic-light: green (completed), amber (processing/pending), red (error) |
| File name truncation | `title` attribute on the `<Link>` shows full name on hover |
| Loading indicator | Thin 2px top-border animation (`h-0.5 bg-[#115ACB] animate-pulse`) |
| Empty state icon | Filled circle `bg-[#EEF2FF]` Indigo 50; document SVG `text-[#115ACB]` |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| `total === 0` | Render `<EmptyState />` instead of table |
| `status='error'` row | "Failed" badge (red); "Retry" link → `/upload?retry=[id]` |
| File name > 40 chars | Truncated with `…`; full name in `title` attribute |
| `total > 20` | `<Pagination />` shown; previous page button disabled on page 1 |
| Sort column changed | `page` resets to 1 to avoid empty result sets |
| API returns 401 | Client receives error; middleware will redirect on next navigation |
| Concurrent tabs updating contracts | Dashboard does not real-time subscribe; user can refresh manually |
| `page_count` = 0 or null | Should not occur per schema constraint `page_count > 0`, but display "—" defensively |
