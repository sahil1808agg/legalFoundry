import { createClient } from '@supabase/supabase-js'

// Singleton — one admin client per process.
// Uses the service role key which bypasses RLS.
// MUST only be used in server-side code (API routes, server actions).
let _adminClient: ReturnType<typeof createClient> | null = null

export function createAdminClient() {
  if (_adminClient) return _adminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — cannot create admin client')
  }

  _adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return _adminClient
}
