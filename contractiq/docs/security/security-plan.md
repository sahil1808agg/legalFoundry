# ContractIQ — Security Plan

## Overview

ContractIQ processes user-uploaded legal contracts through an AI extraction pipeline. Every security control is designed to protect: (1) confidential contract content, (2) user identity and sessions, and (3) the AI pipeline from adversarial manipulation.

---

## 1. Authentication & Session Security

| Control | Implementation |
|---|---|
| Session validation | `getUser()` (not `getSession()`) — forces server-side JWT verification via Supabase Auth |
| Middleware protection | `middleware.ts` runs `supabase.auth.getUser()` on every protected route; redirects to `/sign-in` on failure |
| Protected routes | `/dashboard`, `/upload`, `/results/*` — all guarded by middleware |
| Server-side login | `POST /api/auth/login` — Supabase `signInWithPassword` called server-side; cookies set via SSR client |
| Server-side logout | `POST /api/auth/logout` — `signOut()` called server-side; cookie cleared |
| Client isolation | `sign-in-form.tsx` calls `/api/auth/login`; no Supabase client used in auth forms |

**Why `getUser()` not `getSession()`:** `getSession()` reads from the cookie without verifying the JWT signature against Supabase's server. A tampered cookie would pass `getSession()` but fail `getUser()`.

---

## 2. API Route Protection

Every API route uses the `requireAuth()` helper from `lib/security/authGuard.ts`:

```
POST /api/upload      — requireAuth + checkRateLimit('upload')
POST /api/process     — requireAuth + checkRateLimit('process')
POST /api/chat        — requireAuth + checkRateLimit('chat')
PATCH /api/terms/[id] — requireAuth
POST /api/feedback    — requireAuth
GET  /api/dashboard   — requireAuth
POST /api/auth/login  — public (rate-limited by IP in Supabase)
POST /api/auth/logout — public
```

`requireAuth()` returns a typed result: `{ user } | { error: 401 Response }`. Routes destructure and early-return on error.

---

## 3. Input Validation

All request bodies are validated with Zod schemas (`lib/security/inputValidator.ts`) before any DB operation:

| Schema | Route | Key constraints |
|---|---|---|
| `chatBodySchema` | `/api/chat` | `contract_id` is UUID; `question` max 5,000 chars |
| `processBodySchema` | `/api/process` | `contract_id` is UUID |
| `uploadBodySchema` | (formData fields) | `contract_type` enum; `custom_terms` max 5 items, 100 chars each |
| `termPatchSchema` | `/api/terms/[id]` | `value` max 5,000 chars, non-empty |
| `feedbackBodySchema` | `/api/feedback` | `rating` enum; `comment` max 1,000 chars |
| `dashboardQuerySchema` | `/api/dashboard` | `sort_by` allowlist; `limit` max 50 |

Unknown fields are stripped by Zod's `safeParse`. Invalid requests return 422 before any business logic runs.

---

## 4. File Upload Security

`validateFileUpload()` in `lib/security/inputValidator.ts` enforces four layers in order:

1. **Extension blocklist** — `.exe`, `.js`, `.mjs`, `.cjs`, `.php`, `.zip`, `.sh`, `.bat`, `.cmd`, `.py`, `.rb`, `.ps1` are rejected immediately
2. **Extension allowlist** — only `.pdf` and `.docx` pass
3. **MIME type check** — `application/pdf` or `.docx` MIME required (defence against renamed files)
4. **Size limit** — 10 MB maximum

After extraction, `validatePDF()` enforces content-level limits:
- Minimum 100 words (rejects blank/scanned-only PDFs)
- Maximum 20 pages
- Maximum 15,000 tokens (prevents LLM context overflow)

---

## 5. Rate Limiting

Implemented via `lib/security/rateLimiter.ts` using a sliding window stored in `rate_limit_events` (accessed via service role key to bypass RLS):

| Endpoint | Limit | Window |
|---|---|---|
| `upload` | 20 requests | 24 hours |
| `process` | 5 requests | 1 hour |
| `chat` | 30 requests | 1 minute |
| `auth` (login) | 10 requests | 1 minute |

Rate-limited responses return HTTP 429 with a `Retry-After` header. On DB error, the rate limiter **fails open** (allows the request) to prevent a DB outage from locking all users out.

The `rate_limit_events` table has no user-facing RLS policies. It is only accessible via the service role key (`SUPABASE_SERVICE_ROLE_KEY`), which is server-side only.

---

## 6. Prompt Injection Protection

`sanitizeForLLM()` in `lib/security/promptInjectionGuard.ts` scans every chat question before it reaches the OpenAI API. It blocks 20+ patterns including:

- `ignore previous instructions` / `ignore all instructions`
- `reveal system prompt` / `show system message`
- `act as` / `pretend to be` / `roleplay as`
- `jailbreak` / `DAN mode` / `developer mode`
- `<system>`, `[INST]`, `<<SYS>>` (LLM instruction injection markers)
- `\x00` through `\x1f` (control character injection)
- Base64 strings > 100 chars (obfuscated payload detection)

Blocked requests return 400 with a generic "Message not allowed" error (no pattern details disclosed).

---

## 7. Token & Message Length Limits

`lib/security/tokenLimiter.ts` enforces:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_FILE_SIZE_BYTES` | 10 MB | Upload size cap |
| `MAX_PAGE_COUNT` | 20 | PDF page cap |
| `MAX_CONTRACT_TOKENS` | 15,000 | LLM context cap |
| `MAX_MESSAGE_LENGTH` | 5,000 chars | Chat question cap |
| `MAX_CHAT_HISTORY` | 100 (env override) | History trim cap |

`trimHistory()` trims the oldest messages when history exceeds `MAX_CHAT_HISTORY`. This prevents a single session from consuming unbounded context.

---

## 8. Contract Ownership & Access Control

`verifyContractOwnership()` in `lib/security/chatSecurity.ts`:
- Fetches contract with `.eq('user_id', userId)` — DB-level ownership check
- Verifies `status === 'completed'` — prevents chat on unprocessed contracts
- Returns `contract_text` only on success — never leaks content to wrong user

All Supabase queries on user-owned tables double-filter with `.eq('user_id', user.id)`, even though RLS would enforce this independently. Defence in depth.

---

## 9. Row-Level Security (Supabase)

Every table has RLS enabled. All policies enforce `auth.uid() = user_id`:

| Table | Policies |
|---|---|
| `profiles` | SELECT/UPDATE own row only |
| `contracts` | SELECT/INSERT/UPDATE/DELETE own rows only |
| `key_terms` | SELECT/INSERT/UPDATE own rows only |
| `custom_key_terms` | SELECT/INSERT/DELETE own rows only |
| `chat_sessions` | SELECT/INSERT own rows only |
| `chat_messages` | SELECT/INSERT own rows only |
| `user_feedback` | SELECT/INSERT/UPDATE own rows only |
| `term_corrections` | INSERT own rows only |
| `rate_limit_events` | Deny all (service role bypasses) |

Storage bucket `contracts`:
- INSERT: `auth.uid()::text = (storage.foldername(name))[1]`
- SELECT: same check
- DELETE: same check

Path convention: `{user_id}/{contract_id}/{filename}.pdf`

---

## 10. Environment Variable Security

| Variable | Exposure | Used in |
|---|---|---|
| `OPENAI_API_KEY` | Server-side only | `lib/openai/` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only | `lib/supabase/admin.ts` |
| `NEXT_PUBLIC_SUPABASE_URL` | Client-safe | Supabase client init |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-safe | Supabase client init |
| `MAX_CHAT_HISTORY` | Server-side only | `lib/security/tokenLimiter.ts` |

`OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must **never** be prefixed with `NEXT_PUBLIC_`. They are used only in server components and API routes.

---

## 11. Files Created / Modified

### New files
| File | Purpose |
|---|---|
| `lib/security/authGuard.ts` | `requireAuth()` helper — wraps `getUser()` with typed result |
| `lib/security/rateLimiter.ts` | Sliding-window rate limiter via `rate_limit_events` table |
| `lib/security/promptInjectionGuard.ts` | `sanitizeForLLM()` — 20+ regex pattern blocker |
| `lib/security/tokenLimiter.ts` | File/message/history size constants and helpers |
| `lib/security/chatSecurity.ts` | `verifyContractOwnership()` and `verifySessionOwnership()` |
| `lib/security/inputValidator.ts` | Zod schemas for all routes + `validateFileUpload()` |
| `lib/supabase/admin.ts` | Singleton service-role Supabase client |
| `supabase/rls-policies.sql` | `rate_limit_events` table + storage policies + column migration |

### Modified files
| File | Change |
|---|---|
| `app/api/chat/route.ts` | Full security layer: auth, rate limit, validation, sanitization, ownership check |
| `app/api/upload/route.ts` | `requireAuth`, `checkRateLimit('upload')`, `validateFileUpload` |
| `app/api/process/route.ts` | `requireAuth`, `checkRateLimit('process')`, `parseBody(processBodySchema)` |
| `app/api/terms/[id]/route.ts` | `requireAuth`, `parseBody(termPatchSchema)` |
| `app/api/feedback/route.ts` | `requireAuth`, `parseBody(feedbackBodySchema)` |
| `app/api/dashboard/route.ts` | `requireAuth`, `parseBody(dashboardQuerySchema)`, parallel count queries |
| `components/auth/sign-in-form.tsx` | Uses `POST /api/auth/login` instead of Supabase client directly |
| `components/auth/sign-out-button.tsx` | Uses `POST /api/auth/logout` instead of Supabase client directly |
| `middleware.ts` | Routes fixed (`/sign-in` not `/auth/sign-in`); uses `getUser()` |

---

## 12. Checklist

- [x] Auth: `getUser()` on every protected server request
- [x] Middleware: protects `/dashboard`, `/upload`, `/results/*`
- [x] All API routes: `requireAuth()` before any logic
- [x] Rate limiting on upload, process, and chat endpoints
- [x] Input validation with Zod on all request bodies
- [x] File upload: 4-layer validation (ext blocklist → allowlist → MIME → size)
- [x] Prompt injection guard on all chat questions
- [x] Token limits on contract text and chat history
- [x] Contract ownership verified before chat and term edit
- [x] RLS enabled on all tables; every policy enforces `auth.uid() = user_id`
- [x] Storage RLS enforces user folder path
- [x] `OPENAI_API_KEY` server-side only (never `NEXT_PUBLIC_`)
- [x] `SUPABASE_SERVICE_ROLE_KEY` server-side only; singleton admin client
- [x] Sign-in and sign-out routed through server-side API routes
- [x] `rate_limit_events` inaccessible to client roles (deny-all RLS policy)
