'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function SignUpForm() {
  const supabase = createClient()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: authError } = await supabase.auth.signUp({ email, password })

    if (authError) {
      setError(mapAuthError(authError.message))
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <p className="font-medium text-[#070A0E]">Check your email</p>
        <p className="text-sm text-[#4A4C4F] mt-1">
          We sent a verification link to <strong>{email}</strong>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-[#070A0E]">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="input-base"
          placeholder="you@company.com"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-[#070A0E]">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="input-base"
          placeholder="Minimum 6 characters"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-[#D13438] bg-[#FAEBEB] border border-[#EAA2A3] rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}

function mapAuthError(msg: string): string {
  if (msg.includes('already registered')) return 'An account with this email already exists.'
  if (msg.includes('Password should be'))  return 'Password must be at least 6 characters.'
  if (msg.includes('Invalid email'))       return 'Please enter a valid email address.'
  return 'Something went wrong — please try again.'
}
