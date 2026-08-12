import { NextRequest, NextResponse }           from 'next/server'
import { createClient }                        from '@/lib/supabase/server'
import { requireAuth }                          from '@/lib/security/authGuard'
import { parseBody, dashboardQuerySchema }      from '@/lib/security/inputValidator'

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { user } = auth

  // ── Validate query params ─────────────────────────────────────────────────
  const { searchParams } = request.nextUrl
  const rawQuery = {
    page:     searchParams.get('page')     ?? undefined,
    limit:    searchParams.get('limit')    ?? undefined,
    sort_by:  searchParams.get('sort_by')  ?? undefined,
    sort_dir: searchParams.get('sort_dir') ?? undefined,
  }

  const parsed = parseBody(dashboardQuerySchema, rawQuery)
  if (!parsed.success) return parsed.error
  const { page, limit, sort_by, sort_dir } = parsed.data

  const offset    = (page - 1) * limit
  const ascending = sort_dir === 'asc'

  // ── Fetch contracts ───────────────────────────────────────────────────────
  const supabase = createClient()

  const { data: contracts, error: listError } = await supabase
    .from('contracts')
    .select('id, file_name, contract_type, status, page_count, created_at')
    .eq('user_id', user.id)
    .order(sort_by, { ascending })
    .range(offset, offset + limit - 1)

  if (listError) {
    console.error('Dashboard list error:', listError)
    return NextResponse.json({ error: 'Failed to load contracts' }, { status: 500 })
  }

  const [{ count: total }, { count: ndaCount }, { count: msaCount }] = await Promise.all([
    supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('contract_type', 'nda'),
    supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('contract_type', 'msa'),
  ])

  return NextResponse.json({
    contracts:  contracts ?? [],
    total:      total     ?? 0,
    nda_count:  ndaCount  ?? 0,
    msa_count:  msaCount  ?? 0,
    page,
    limit,
    sort_by,
    sort_dir,
  })
}
