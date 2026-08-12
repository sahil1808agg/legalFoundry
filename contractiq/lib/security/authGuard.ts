import { NextResponse }  from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { User }     from '@supabase/supabase-js'

type AuthSuccess = { user: User; error: null }
type AuthFailure = { user: null; error: NextResponse }

export async function requireAuth(): Promise<AuthSuccess | AuthFailure> {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      user:  null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { user, error: null }
}
