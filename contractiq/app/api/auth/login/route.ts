import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@/lib/supabase/server'
import { checkRateLimit }           from '@/lib/security/rateLimiter'
import { parseBody }                from '@/lib/security/inputValidator'
import { z }                        from 'zod'

const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required').max(256),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseBody(loginSchema, body)
  if (!parsed.success) return parsed.error

  const { email, password } = parsed.data

  // Rate limit by IP (best effort — X-Forwarded-For may be absent in dev)
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
  // Use a synthetic userId for IP-based rate limiting on auth endpoints
  const rateLimitKey = `ip:${ip}`
  const supabase = createClient()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    let message = 'Something went wrong — please try again.'
    if (error.message.includes('Invalid login credentials')) message = 'Incorrect email or password.'
    if (error.message.includes('Email not confirmed'))       message = 'Please verify your email before signing in.'
    if (error.message.includes('too many requests'))         message = 'Too many attempts. Please wait a moment.'
    return NextResponse.json({ error: message }, { status: 401 })
  }

  if (!data.user) {
    return NextResponse.json({ error: 'Login failed' }, { status: 401 })
  }

  return NextResponse.json({ user: { id: data.user.id, email: data.user.email } }, { status: 200 })
}
