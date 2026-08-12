'use client'
import { useState, useCallback } from 'react'
import type { Contract } from '@/types/contract'

export type SortColumn = 'created_at' | 'file_name' | 'contract_type' | 'status' | 'page_count'
export type SortDir    = 'asc' | 'desc'

export type ContractRow = Pick<Contract, 'id' | 'file_name' | 'contract_type' | 'status' | 'page_count' | 'created_at'>

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
  const [error, setError]         = useState<string | null>(null)

  const fetchContracts = useCallback(async (opts: {
    page?: number
    sortBy?: SortColumn
    sortDir?: SortDir
  } = {}) => {
    const p  = opts.page    ?? page
    const sb = opts.sortBy  ?? sortBy
    const sd = opts.sortDir ?? sortDir

    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/dashboard?page=${p}&sort_by=${sb}&sort_dir=${sd}`)
      if (!res.ok) throw new Error('Failed to load contracts')
      const data = await res.json()
      setContracts(data.contracts)
      setTotal(data.total)
      setPage(p)
      setSortBy(sb)
      setSortDir(sd)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, sortDir])

  function handleSort(col: SortColumn) {
    const nextDir: SortDir = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc'
    fetchContracts({ page: 1, sortBy: col, sortDir: nextDir })
  }

  function handlePage(next: number) {
    fetchContracts({ page: next })
  }

  return { contracts, total, page, sortBy, sortDir, loading, error, handleSort, handlePage }
}
