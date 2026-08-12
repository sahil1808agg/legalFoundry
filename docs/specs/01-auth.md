# Spec 01 — Authentication & Session Management

**Stories:** US-001  
**Priority:** P0  
**Files touched:** `middleware.ts`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, `app/(auth)/sign-in/page.tsx`, `app/(auth)/sign-up/page.tsx`, `components/auth/sign-in-form.tsx`, `components/auth/sign-up-form.tsx`

---

## What to Build

Supabase email/password authentication with session refresh via Next.js middleware. No custom auth routes — Supabase Auth handles all token management. Middleware protects `/dashboard`, `/upload`, and `/results/*`; redirects authenticated users away from `/auth/*`.

---

## Acceptance Criteria

- [ ] Sign-up creates a Supabase user and shows "Check your email to verify your account"
- [ ] Sign-in with valid credentials redirects to `/dashboard` within 10 seconds
- [ ] Sign-in with invalid credentials shows a non-generic inline error message
- [ ] Unauthenticated GET to `/dashboard`, `/upload`, or `/results/*` → 307 redirect to `/auth/sign-in`
- [ ] Authenticated GET to `/auth/sign-in` or `/auth/sign-up` → 307 redirect to `/dashboard`
- [ ] Sign-out clears the session and redirects to `/`
- [ ] Page reload on any protected route does NOT flash unauthenticated content before redirect

---

## Supabase Auth Configuration

In Supabase Dashboard → Authentication → Settings:
- Email auth: **enabled**
- Confirm email: **enabled**
- Site URL: `http://localhost:3000` (dev) / `https://your-domain.com` (prod)
- Redirect URLs: `http://localhost:3000/auth/confirm`

No OAuth providers in MVP.

---

## `middleware.ts` — Full Implementation

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // MUST call getUser() (not getSession()) to validate the JWT server-side
  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  const protectedPaths = ['/dashboard', '/upload', '/results']
  const authPaths = ['/auth']

  const isProtected = protectedPaths.some(p => pathname.startsWith(p))
  const isAuthPage  = authPaths.some(p => pathname.startsWith(p))

  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/sign-in'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/upload/:path*',
    '/results/:path*',
    '/auth/:path*',
  ],
}
```

**Why `getUser()` not `getSession()`:** `getSession()` trusts the cookie without server-side JWT validation. `getUser()` validates the JWT against Supabase Auth, preventing session forgery.

---

## `components/auth/sign-up-form.tsx` — Full Implementation

```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignUpForm() {
  const router = useRouter()
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

    const { error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(mapAuthError(error.message))
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
        <label htmlFor="email" className="text-sm font-medium text-[#070A0E]">Email</label>
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
        <label htmlFor="password" className="text-sm font-medium text-[#070A0E]">Password</label>
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
  if (msg.includes('Password should be')) return 'Password must be at least 6 characters.'
  if (msg.includes('Invalid email')) return 'Please enter a valid email address.'
  return 'Something went wrong — please try again.'
}
```

---

## `components/auth/sign-in-form.tsx` — Full Implementation

```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignInForm() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(mapAuthError(error.message))
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-[#070A0E]">Email</label>
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
        <label htmlFor="password" className="text-sm font-medium text-[#070A0E]">Password</label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="input-base"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-[#D13438] bg-[#FAEBEB] border border-[#EAA2A3] rounded-md px-3 py-2">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

function mapAuthError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.'
  if (msg.includes('Email not confirmed')) return 'Please verify your email before signing in.'
  return 'Something went wrong — please try again.'
}
```

---

## Page Wiring

**`app/(auth)/sign-in/page.tsx`**
```typescript
import { SignInForm } from '@/components/auth/sign-in-form'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4">
      <div className="card p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-[#070A0E] mb-1">Sign in</h1>
        <p className="text-sm text-[#4A4C4F] mb-6">Welcome back to ContractIQ</p>
        <SignInForm />
        <p className="text-xs text-[#4A4C4F] text-center mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/sign-up" className="text-[#115ACB] hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
```

**`app/(auth)/sign-up/page.tsx`** — same structure, uses `<SignUpForm />`, links to sign-in.

---

## Sign-Out Action

Add to the dashboard header or a nav menu:

```typescript
'use client'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function SignOutButton() {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button onClick={handleSignOut} className="btn-ghost text-sm">
      Sign out
    </button>
  )
}
```

---

## Design Tokens Used

| Element | Token | Value |
|---|---|---|
| Page background | Grey 25 | `#FAFAFA` |
| Card | White | `#FFFFFF` |
| Primary text | Grey 900 | `#070A0E` |
| Secondary text | Grey 500 | `#4A4C4F` |
| Link / focus ring | Blue 500 | `#115ACB` |
| Error text | Red 500 | `#D13438` |
| Error background | Red 50 | `#FAEBEB` |
| Error border | Red 200 | `#EAA2A3` |
| Input focus | Blue 500 2px ring | `#115ACB` |

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Email not verified on sign-in | Show "Please verify your email before signing in." |
| Duplicate email on sign-up | Show "An account with this email already exists." |
| Password < 6 chars | `minLength={6}` on input prevents submission; Supabase also enforces |
| Session expires mid-session | Middleware `getUser()` will fail; user is redirected to sign-in on next navigation |
| Network error during auth call | Show generic "Something went wrong" error |
| Double submit (click twice) | Button disabled while `loading = true`; second click is a no-op |
