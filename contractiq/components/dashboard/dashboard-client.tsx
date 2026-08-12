'use client'
import Link from 'next/link'
import { useDashboard, type ContractRow } from '@/hooks/use-dashboard'
import { SummaryCards }   from './summary-cards'
import { DashboardTable } from './dashboard-table'
import { EmptyState }     from './empty-state'
import { Pagination }     from './pagination'
import { SignOutButton }  from '@/components/auth/sign-out-button'

interface Props {
  initialContracts: ContractRow[]
  initialTotal:     number
  initialNdaCount:  number
  initialMsaCount:  number
}

export function DashboardClient({
  initialContracts,
  initialTotal,
  initialNdaCount,
  initialMsaCount,
}: Props) {
  const {
    contracts, total, page, sortBy, sortDir, loading, error, handleSort, handlePage,
  } = useDashboard({ initialContracts, initialTotal })

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Top nav */}
      <header className="bg-white border-b border-[#F0F0F1]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-lg font-semibold text-[#070A0E]">
            Contract<span className="text-[#115ACB]">IQ</span>
          </Link>
          <SignOutButton />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#070A0E]">Dashboard</h1>
            <p className="text-sm text-[#4A4C4F] mt-0.5">Your contract review history</p>
          </div>
          <Link href="/upload" className="btn-primary">
            + Upload Contract
          </Link>
        </div>

        {/* Summary cards */}
        <SummaryCards total={initialTotal} ndaCount={initialNdaCount} msaCount={initialMsaCount} />

        {/* Table or empty state */}
        {total === 0 && !loading ? (
          <EmptyState />
        ) : (
          <div className="card overflow-hidden">
            {loading && (
              <div className="h-0.5 bg-[#115ACB] animate-pulse" />
            )}
            {error && (
              <div className="px-4 py-3 bg-[#FAEBEB] border-b border-[#EAA2A3] text-sm text-[#581618]">
                {error}
              </div>
            )}
            {contracts.length > 0 ? (
              <>
                <DashboardTable
                  contracts={contracts}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <Pagination page={page} total={total} limit={20} onPage={handlePage} />
              </>
            ) : loading ? (
              <div className="p-8 text-center text-sm text-[#4A4C4F]">Loading…</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
