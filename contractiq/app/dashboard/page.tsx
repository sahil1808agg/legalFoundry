import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/dashboard/dashboard-client'
import type { ContractRow } from '@/hooks/use-dashboard'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const [listResult, totalResult, ndaResult, msaResult] = await Promise.all([
    supabase
      .from('contracts')
      .select('id, file_name, contract_type, status, page_count, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('contracts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('contracts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('contract_type', 'nda'),
    supabase
      .from('contracts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('contract_type', 'msa'),
  ])

  return (
    <DashboardClient
      initialContracts={(listResult.data ?? []) as ContractRow[]}
      initialTotal={totalResult.count ?? 0}
      initialNdaCount={ndaResult.count ?? 0}
      initialMsaCount={msaResult.count ?? 0}
    />
  )
}
