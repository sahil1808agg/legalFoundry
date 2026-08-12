import { NextResponse }       from 'next/server'
import { createAdminClient }  from '@/lib/supabase/admin'

interface RateLimitRule {
  action:        string
  limit:         number
  windowSeconds: number
}

const RULES: Record<string, RateLimitRule> = {
  auth:    { action: 'auth',    limit: 10, windowSeconds: 60      },  // 10 / minute
  chat:    { action: 'chat',    limit: 30, windowSeconds: 60      },  // 30 / minute
  process: { action: 'process', limit: 5,  windowSeconds: 3600    },  // 5  / hour
  upload:  { action: 'upload',  limit: 20, windowSeconds: 86400   },  // 20 / day
}

type RateLimitOk      = { limited: false }
type RateLimitBlocked = { limited: true; response: NextResponse }

export async function checkRateLimit(
  userId: string,
  key: keyof typeof RULES,
): Promise<RateLimitOk | RateLimitBlocked> {
  const rule    = RULES[key]
  const supabase = createAdminClient()
  const since   = new Date(Date.now() - rule.windowSeconds * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from('rate_limit_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('action',  rule.action)
    .gte('created_at', since)

  if (error) {
    // Fail open — never block a user because of a DB error
    console.error('Rate limit check error:', error)
    return { limited: false }
  }

  if ((count ?? 0) >= rule.limit) {
    return {
      limited:  true,
      response: NextResponse.json(
        { error: 'Too many requests — please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(rule.windowSeconds) } }
      ),
    }
  }

  // Record this event (non-blocking; failure is not fatal)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(supabase as any)
    .from('rate_limit_events')
    .insert({ user_id: userId, action: rule.action })
    .then(({ error: e }: { error: unknown }) => { if (e) console.error('Rate limit insert error:', e) })

  return { limited: false }
}
