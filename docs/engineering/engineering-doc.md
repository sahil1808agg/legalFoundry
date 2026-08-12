# ContractIQ — Engineering Document (High-Level Design)

**Version:** 1.0  
**Date:** 2026-08-12  
**Status:** Draft — Awaiting Approval  
**Based on PRD:** ContractIQ PRD v1.0 (June 24, 2026)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Scope](#2-product-scope)
3. [User Personas](#3-user-personas)
4. [User Flows](#4-user-flows)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Backend Architecture](#6-backend-architecture)
7. [Database Design and Schema](#7-database-design-and-schema)
8. [AI Architecture](#8-ai-architecture)
9. [API Specification](#9-api-specification)
10. [Feature Breakdown](#10-feature-breakdown)
11. [Folder Structure](#11-folder-structure)
12. [Naming Conventions](#12-naming-conventions)
13. [Testing Strategy](#13-testing-strategy)
14. [Specs to Implementation Mapping](#14-specs-to-implementation-mapping)

---

## 1. Executive Summary

### Project Name
ContractIQ

### Business Goal
Reduce NDA and MSA contract review time from 90–120 minutes (manual, unassisted) to ≤ 15 minutes end-to-end for SMBs and freelancers who have no in-house legal counsel.

### Problem Statement
Business professionals routinely sign NDAs and MSAs without fully understanding what they are agreeing to. Without legal expertise, a single contract review takes 90–120 minutes, frequently misses key obligations (auto-renewal clauses, IP assignment, indemnification limits), and costs $1,500–$3,000 per lawyer-reviewed contract. Existing tools (DocuSign CLM, Ironclad, Kira Systems) are enterprise-priced and complexity-heavy. Generic AI assistants (ChatGPT) lack structured extraction, page-level attribution, confidence scoring, and contract-type-specific term libraries.

### Target Users
| Persona | Description |
|---|---|
| Time-Pressed Founder / Ops Lead | SaaS/agency/fintech companies, 5–250 employees, no in-house legal; signs 5–15 NDAs or MSAs per month |
| Freelancer / Consultant | Individual contributors receiving 1–4 MSAs/month from larger clients; cannot afford legal review |

### Success Criteria

| Metric | Target |
|---|---|
| End-to-end review time | ≤ 15 minutes (North Star) |
| Key-term extraction accuracy (F1) | ≥ 88% on NDA test set; ≥ 85% on MSA test set |
| Time to first key-term display | ≤ 30 seconds P95 for contracts ≤ 20 pages |
| AI extraction correction rate | ≤ 12% of terms manually corrected |
| Cost per contract analysis | ≤ $0.25 per 20-page contract |
| 30-day user retention | ≥ 45% |
| NPS | ≥ 40 |
| Chat response latency | ≤ 15 seconds P95 |

---

## 2. Product Scope

### In Scope (MVP — v0.1 through v1.0)

- Email/password authentication via Supabase Auth
- PDF upload (text-layer only, ≤ 10 MB, ≤ 20 pages)
- Server-side text extraction with `[PAGE N]` markers stored once in DB
- Structured key-term extraction via GPT-4o for NDA (10 terms) and MSA (12 terms)
- Confidence scoring (0–100%) per term with colour-coded display and low-confidence warnings
- Custom key term addition (up to 5 per analysis) before processing
- Source sentence attribution per extracted term (expandable "Why?" section)
- Two-panel results page: inline PDF viewer (PDF.js) + key terms panel
- Text viewer fallback when Supabase Storage is unavailable
- Click-to-navigate from key term to page in PDF viewer
- Contract chat: grounded Q&A on the uploaded document with mandatory page citation
- Persistent chat history per contract (saved to Supabase)
- Dashboard with contract history (sortable: date, name, type)
- Inline key term editing with correction logging
- Feedback submission (thumbs up/down + optional comment)
- Row-level security on all tables; Supabase Storage with signed URLs (1-hour expiry)
- "Not legal advice" disclaimer on all results pages
- WCAG 2.1 AA compliance

### Out of Scope (MVP)

- Scanned/image PDFs (OCR not supported; graceful error if extracted text < 100 words)
- Non-English contracts or non-US/UK governed contracts
- Batch contract upload (> 1 at a time)
- CSV or PDF export of key terms
- Multi-user workspaces or team plans
- Contract comparison view
- Email notifications on processing completion
- Fine-tuned models (deferred to v2)
- Chunked RAG (deferred until token limits increase post-v1.0)

### Future Enhancements (v1.1 and beyond)

| Version | Feature |
|---|---|
| v1.1 | Export to CSV; export results summary to PDF; batch upload (up to 5 contracts); dashboard analytics charts |
| v1.2 | Scanned PDF support via OCR (AWS Textract); contract comparison view; email notifications; multi-user workspace (team plans) |
| v2.0 | Fine-tuned extraction model; non-US/UK contract jurisdiction support; API access tier |

---

## 3. User Personas

### Persona 1 — Time-Pressed Founder / Ops Lead (Primary)

| Attribute | Detail |
|---|---|
| **Industries** | SaaS, agency, professional services, fintech, e-commerce |
| **Role** | Founder, COO, Procurement Manager, Legal Operations Manager |
| **Company size** | 5–250 employees; no in-house legal counsel |
| **Contract volume** | 5–15 NDAs or MSAs per month |
| **Behaviour** | Relies on Google searches or ad-hoc legal consultations to understand terms |
| **Pain** | 90–120 min per review; misses auto-renewal clauses, indemnification limits, IP assignment; $250–$500/hr legal costs |
| **Primary workflow** | Upload contract → review extracted key terms → spot-check low-confidence terms → ask clarifying questions via chat → sign or escalate |
| **Permissions** | Full access to own contracts, key terms, chat, dashboard, feedback |

### Persona 2 — Freelancer / Consultant (Secondary)

| Attribute | Detail |
|---|---|
| **Industries** | Design, marketing, software development, consulting |
| **Role** | Individual contributor |
| **Contract volume** | 1–4 MSAs per month received from larger clients |
| **Behaviour** | Often signs without reading because power imbalance discourages pushback |
| **Pain** | Cannot afford legal review; unsure which clauses are non-standard or risky |
| **Primary workflow** | Upload MSA from client → check for unusual or risky terms → ask "Is there a non-compete?" in chat → decide whether to push back |
| **Permissions** | Same as Persona 1 — all access scoped to own data |

---

## 4. User Flows

### Flow 1 — New Visitor → Sign Up → Dashboard

```
User lands on landing page (/) 
  → Clicks "Get Started Free" 
    → Frontend: renders Supabase Auth modal (email + password fields)
      → Backend: Supabase Auth creates user record, sends verification email
        → DB: auth.users row created; profiles row created via trigger
          → System: redirects to /dashboard with empty state
            → Frontend: renders "No contracts reviewed yet — upload your first contract to begin" + "Review a Contract" CTA
```

**Acceptance criteria:**
- Auth flow completes within 10 seconds
- Invalid credentials return a clear, non-generic error ("Incorrect email or password")
- Email verification required before dashboard access

---

### Flow 2 — Returning User → Sign In → Dashboard

```
User visits / 
  → Clicks "Sign In"
    → Frontend: renders sign-in form
      → Backend: Supabase Auth validates credentials, returns session token
        → DB: session token stored in browser (Supabase handles)
          → Frontend: redirects to /dashboard
            → Frontend: fetches contracts list via GET /api/dashboard
              → DB: queries contracts table WHERE user_id = auth.uid() ORDER BY created_at DESC
                → System: renders summary cards (total contracts, breakdown by type) + sortable contract list
```

**Acceptance criteria:**
- Sign-in completes within 10 seconds
- Dashboard shows correct counts and last 5 contracts
- Clicking any contract row opens `/results/[contractId]`

---

### Flow 3 — Core Contract Review

```
User clicks "Review a Contract" 
  → Frontend: renders /upload page
    → User selects contract type (NDA or MSA) from dropdown
      → Frontend: shows pre-processing preview card listing standard terms for selected type
        → User drags/drops or file-picks a PDF (≤ 10 MB, ≤ 20 pages)
          → User optionally clicks "+ Add Key Term" and types custom terms (up to 5)
            → Frontend: appends custom terms to preview list with "Custom" badge
              → User clicks "Process Contract"
                → Frontend: shows step-by-step progress (Step 1: Extracting text → Step 2: Analysing with AI → Step 3: Compiling results)

  POST /api/upload
    → Backend: receives PDF binary; runs pdfjs-dist text extraction server-side; validates text length (≥ 100 words, ≤ 15,000 tokens, ≤ 20 pages)
      → DB: INSERT INTO contracts (user_id, file_name, contract_type, contract_text, status='processing', page_count, token_count)
        → Backend (non-blocking): uploads PDF binary to Supabase Storage at contracts/{user_id}/{contract_id}/{filename}.pdf; updates contracts.file_path on success; swallows error on failure

  POST /api/process
    → Backend: reads contract_text from DB; builds few-shot extraction prompt (contract_type + standard terms + custom terms); calls GPT-4o with JSON mode, temperature=0.1, max_tokens=2000
      → OpenAI: returns JSON array [{ term_name, value, page_number, confidence_score, source_sentence }]
        → Backend: validates JSON; on parse failure → single retry with "Return only the JSON array" prompt
          → DB: INSERT INTO key_terms (contract_id, user_id, term_name, value, page_number, confidence_score, source_sentence, is_manual) for each term
            → DB: UPDATE contracts SET status='completed'

  GET /api/contracts/[id]
    → Backend: fetches contract row + key_terms rows; generates 1-hour signed URL from Supabase Storage (graceful null on failure)
      → Frontend: renders two-panel results page
          Left panel: PDFViewer (if signed URL present) or TextViewerFallback (parses [PAGE N] markers from contract_text)
          Right panel: KeyTermsPanel — each TermCard shows Term Name | Value | Page | Confidence badge (green/amber/red)
          Low-confidence terms (< 50%): ⚠️ icon + non-dismissible tooltip + auto-highlight in viewer
          Footer: "This is an AI-assisted review tool, not legal advice."
```

**Acceptance criteria:**
- Upload rejects files > 10 MB or > 20 pages with a specific error message
- Extraction completes within 30 seconds P95 for ≤ 20-page contracts
- Results panel shows all standard terms + any custom terms with identical data structure
- Confidence scores are colour-coded; scores < 50% show warning icon

---

### Flow 4 — Chat with Contract

```
User clicks "Chat" tab on results page
  → Frontend: renders ChatInterface panel; loads existing messages via GET chat_messages WHERE session_id = current session

User types question (e.g. "What happens if I breach the NDA?")
  → Frontend: optimistically renders user message, shows typing indicator

  POST /api/chat
    → Backend: fetches full contract_text + all chat_messages for session (ascending) from DB
      → Backend: classifies query type (contract / history / both) to adjust system prompt context
        → Backend: calls GPT-4o with system prompt: "Answer only from the document text provided. If the answer is not in the document, say 'I cannot find this in the document.'" + full contract text + conversation history, temperature=0.4, max_tokens=1000
          → OpenAI: returns plain-English response with mandatory [Page X] citation
            → DB: INSERT INTO chat_messages x2 (role='user', role='assistant')
              → Frontend: renders assistant response with "Source: Page X" link
                → Clicking "Source: Page X" sets targetPage prop on viewer, scrolling to that page
```

**Acceptance criteria:**
- Chat responds within 15 seconds P95
- Every AI response includes a `[Page X]` citation
- Chat history persists; reopening results page reloads previous messages
- Response prefixed with "Based on the document…" framing
- When information is absent: "I cannot find this in the document" (not a fabricated answer)

---

## 5. Frontend Architecture

### Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Framework | Next.js | 14 (App Router) |
| Styling | Tailwind CSS | v3 — all colours, spacing, and typography from `docs/design.md` |
| PDF rendering | PDF.js (pdfjs-dist) | Client-side; lazy page loading for large files |
| State management | React `useState` / `useReducer` + React Context | Local component state; no global store library at MVP |
| Auth client | `@supabase/ssr` | Session management in middleware + server components |
| DB client | `@supabase/supabase-js` | Client-side reads for auth + real-time subscriptions |
| HTTP | `fetch` (native) | API routes called from client components |
| TypeScript | 5.x | Strict mode; all props and API responses typed |

### Pages

| Route | Page Component | Description |
|---|---|---|
| `/` | `app/page.tsx` | Marketing landing page — value prop, demo GIF, "Sign In" + "Get Started Free" CTAs |
| `/auth/sign-in` | `app/(auth)/sign-in/page.tsx` | Supabase Auth sign-in form |
| `/auth/sign-up` | `app/(auth)/sign-up/page.tsx` | Supabase Auth sign-up form |
| `/dashboard` | `app/dashboard/page.tsx` | Contract history table + summary cards + "Review a Contract" CTA |
| `/upload` | `app/upload/page.tsx` | Contract type selector + PDF uploader + custom term adder + process trigger |
| `/results/[id]` | `app/results/[id]/page.tsx` | Two-panel results view: PDF/text viewer (left) + key terms + chat (right) |

### Component Hierarchy

```
app/
├── layout.tsx                    # Root layout — Supabase session provider, global nav
│
├── (auth)/
│   ├── sign-in/page.tsx
│   └── sign-up/page.tsx
│       └── components/auth/
│           ├── sign-in-form.tsx
│           └── sign-up-form.tsx
│
├── dashboard/page.tsx
│   └── components/dashboard/
│       ├── dashboard-table.tsx   # Sortable contract list
│       ├── summary-cards.tsx     # Total contracts, by-type breakdown
│       └── empty-state.tsx       # "No contracts yet" illustration + CTA
│
├── upload/page.tsx
│   └── components/contract/
│       ├── contract-uploader.tsx # Drag-and-drop + file picker; validates size/page count
│       ├── contract-type-select.tsx
│       ├── term-preview-card.tsx # Shows standard terms list + custom term badges
│       ├── custom-term-adder.tsx # "+ Add Key Term" input; max 5 terms
│       └── process-button.tsx    # Triggers /api/upload + /api/process; shows progress steps
│
└── results/[id]/page.tsx
    ├── components/contract/
    │   ├── pdf-viewer.tsx        # PDF.js viewer; accepts targetPage prop
    │   ├── text-viewer-fallback.tsx # Parses [PAGE N] markers; same targetPage interface
    │   ├── key-terms-panel.tsx   # Right panel wrapper
    │   └── term-card.tsx         # Term Name | Value | Page | Confidence badge | source tooltip | inline edit
    ├── components/chat/
    │   ├── chat-interface.tsx    # Tab/sidebar; message list + input
    │   └── chat-message.tsx      # User message (right) / AI response (left) with page citation link
    └── components/ui/
        ├── confidence-badge.tsx  # Green/amber/red badge; ⚠️ icon below 50%
        ├── source-tooltip.tsx    # Expandable "Why?" showing source_sentence
        ├── feedback-widget.tsx   # Thumbs up/down + optional comment textarea
        └── disclaimer-banner.tsx # "Not legal advice" footer — always visible on results
```

### UX States

| State | Component | Behaviour |
|---|---|---|
| Loading — upload processing | `process-button.tsx` | Step indicator: "Extracting text → Analysing with AI → Compiling results" |
| Loading — dashboard | `dashboard-table.tsx` | Skeleton rows |
| Loading — chat | `chat-interface.tsx` | Typing indicator (three-dot animation) |
| Empty — dashboard | `empty-state.tsx` | Illustration + "Upload your first contract" CTA |
| Error — upload rejected | `contract-uploader.tsx` | Inline error: "File exceeds 10 MB limit" / "PDF exceeds 20 pages" |
| Error — OpenAI timeout | `process-button.tsx` | Banner: "Analysis timed out — please try again" + retry button |
| Error — scanned PDF | `contract-uploader.tsx` | "Scanned PDFs are not supported yet. Please upload a text-based PDF." |
| Low confidence | `confidence-badge.tsx` | Red badge + ⚠️ + non-dismissible tooltip |
| PDF viewer unavailable | `results/[id]/page.tsx` | `TextViewerFallback` renders automatically; no error shown to user |
| Responsive | All pages | Mobile-first Tailwind breakpoints; PDF viewer collapses to tabbed view on mobile |
| Accessibility | All interactive elements | WCAG 2.1 AA: ARIA labels, keyboard navigation, focus rings, colour contrast ≥ 4.5:1 |

---

## 6. Backend Architecture

### Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Next.js API Routes (Edge-compatible) | Deployed as Netlify serverless functions |
| PDF text extraction | `pdfjs-dist` (Node.js) | Server-side only; no data egress |
| AI inference | OpenAI Node.js SDK | GPT-4o; JSON mode; server-side only (API key never in client) |
| Auth validation | `@supabase/ssr` | `createServerClient` validates session on every protected route |
| Database writes | `@supabase/supabase-js` with `service_role` key | Used only in API routes; full DB access bypasses RLS for writes |
| Storage uploads | Supabase Storage REST API | Non-blocking; failure only hides PDF viewer |

### Core Architecture Principle

The backend is a **thin orchestration layer**. No business logic beyond orchestration. Each API route:
1. Validates the incoming request (auth, schema, file constraints)
2. Reads or writes to Supabase
3. Calls OpenAI if needed
4. Returns a typed JSON response

No route downloads the PDF from Storage — all AI processing reads `contracts.contract_text` from the database.

### Service Interaction Diagram

```
Browser (Next.js client)
        │
        │ POST /api/upload          POST /api/process
        │ GET  /api/contracts/[id]  PATCH /api/terms/[id]
        │ POST /api/chat            GET   /api/dashboard
        │ POST /api/feedback
        ▼
Next.js API Routes (Netlify Serverless)
        │
        ├─── Supabase Auth ─────────────► validates JWT on every request
        │
        ├─── pdfjs-dist ────────────────► extracts text + [PAGE N] markers at upload
        │
        ├─── OpenAI API (GPT-4o) ───────► key-term extraction + chat Q&A
        │         ▲ server-side only; OPENAI_API_KEY never reaches client
        │
        └─── Supabase ──────────────────► PostgreSQL (all tables) + Storage (PDF files)
```

### Error Handling

| Error Scenario | Behaviour |
|---|---|
| PDF > 10 MB or > 20 pages | `POST /api/upload` returns 400 with message: `"File exceeds upload limits"` |
| Extracted text < 100 words | Returns 422 with `"Scanned PDFs are not supported yet"` |
| Token count > 15,000 | Returns 422 with `"Contract exceeds the maximum supported length"` |
| OpenAI API timeout | 3-attempt exponential backoff (1s, 2s, 4s); on final failure → `contracts.status = 'error'`; returns 503 with retry message |
| OpenAI JSON parse failure | Single automatic retry with `"Return only the JSON array, no explanation."` prompt; on second failure → 502 |
| Supabase Storage upload failure | Non-blocking; swallow error; `contracts.file_path` stays null; PDF viewer hides; text viewer fallback activates |
| Auth missing / invalid | All protected routes return 401 |

---

## 7. Database Design and Schema

### Overview

All tables live in a single Supabase project (PostgreSQL). Every table has:
- A `user_id uuid` column referencing `auth.users(id)` with `ON DELETE CASCADE`
- A Row Level Security policy enforcing `auth.uid() = user_id`

The complete schema (all tables, indexes, triggers, RLS policies, Storage bucket creation, Storage RLS policies) is expressed as a single paste-and-run SQL file at `docs/specs/supabase-schema.sql` (generated in Stage 2).

---

### Table: `contracts`

**Purpose:** One row per uploaded contract. The extracted text is stored here so the AI pipeline never re-downloads the PDF.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | |
| `file_name` | `text` | NOT NULL | Original filename |
| `contract_type` | `text` | NOT NULL, CHECK IN ('nda','msa') | |
| `contract_text` | `text` | NOT NULL | Full extracted text with `[PAGE N]` markers |
| `file_path` | `text` | NULLABLE | Supabase Storage path; null if Storage upload failed |
| `status` | `text` | NOT NULL, default `'pending'`, CHECK IN ('pending','processing','completed','error') | |
| `page_count` | `integer` | NOT NULL | |
| `token_count` | `integer` | NOT NULL | Approximate GPT token count |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `last_accessed_at` | `timestamptz` | NOT NULL, default `now()` | Updated on results page load; drives 90-day auto-delete |

**Indexes:** `contracts(user_id)`, `contracts(user_id, created_at DESC)`

**RLS Policies:**
- SELECT: `auth.uid() = user_id`
- INSERT: `auth.uid() = user_id`
- UPDATE: `auth.uid() = user_id`
- DELETE: `auth.uid() = user_id`

---

### Table: `key_terms`

**Purpose:** One row per extracted key term (standard or custom) per contract.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `contract_id` | `uuid` | NOT NULL, FK → `contracts(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | Denormalised for RLS simplicity |
| `term_name` | `text` | NOT NULL | e.g. `"Governing Law"` |
| `value` | `text` | NOT NULL | AI-extracted or user-edited value |
| `page_number` | `integer` | NOT NULL | 1-indexed |
| `confidence_score` | `numeric(5,4)` | NOT NULL, CHECK BETWEEN 0 AND 1 | e.g. `0.8750` |
| `source_sentence` | `text` | NOT NULL | Verbatim sentence from contract used to extract the value |
| `is_edited` | `boolean` | NOT NULL, default `false` | True after user inline-edits the term |
| `original_value` | `text` | NULLABLE | Populated with AI's original value when user edits |
| `is_manual` | `boolean` | NOT NULL, default `false` | True for custom (user-defined) terms |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** `key_terms(contract_id)`, `key_terms(user_id)`

**RLS Policies:** SELECT/INSERT/UPDATE/DELETE scoped to `auth.uid() = user_id`

---

### Table: `custom_key_terms`

**Purpose:** Stores the custom term names added by the user during pre-processing. Referenced at processing time to append custom terms to the extraction prompt.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `contract_id` | `uuid` | NOT NULL, FK → `contracts(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | |
| `term_name` | `text` | NOT NULL | User-entered term name |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Constraint:** Max 5 rows per `contract_id` enforced at application level in `POST /api/upload`.

**Indexes:** `custom_key_terms(contract_id)`

---

### Table: `chat_sessions`

**Purpose:** One session per contract per user. Groups chat messages for persistence and history reload.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `contract_id` | `uuid` | NOT NULL, FK → `contracts(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** `chat_sessions(contract_id)`, `chat_sessions(user_id)`

---

### Table: `chat_messages`

**Purpose:** Persistent chat history. All messages (user + assistant) for a session.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `session_id` | `uuid` | NOT NULL, FK → `chat_sessions(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | |
| `role` | `text` | NOT NULL, CHECK IN ('user','assistant') | |
| `content` | `text` | NOT NULL | |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** `chat_messages(session_id, created_at ASC)` — supports ascending fetch for chat history

---

### Table: `user_feedback`

**Purpose:** Per-contract feedback from users (thumbs up/down + optional comment).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `contract_id` | `uuid` | NOT NULL, FK → `contracts(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | |
| `rating` | `text` | NOT NULL, CHECK IN ('up','down') | Thumbs up = `'up'`, thumbs down = `'down'` |
| `comment` | `text` | NULLABLE | Optional free-text comment |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Constraint:** One feedback row per `(contract_id, user_id)` — enforced via UNIQUE constraint.

---

### Table: `term_corrections`

**Purpose:** Audit log of user corrections to AI-extracted terms. Feeds the prompt improvement loop.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `key_term_id` | `uuid` | NOT NULL, FK → `key_terms(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | |
| `original_value` | `text` | NOT NULL | AI's value before user edit |
| `corrected_value` | `text` | NOT NULL | User's corrected value |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

---

### Supabase Storage

| Setting | Value |
|---|---|
| Bucket name | `contracts` |
| Bucket type | Private (not public) |
| File path pattern | `contracts/{user_id}/{contract_id}/{filename}.pdf` |
| Signed URL expiry | 3600 seconds (1 hour) |
| Bucket creation | `INSERT INTO storage.buckets (id, name, public) VALUES ('contracts', 'contracts', false)` |

**Storage RLS Policies (applied to `storage.objects`):**

```sql
-- INSERT: users can only upload to their own folder
CREATE POLICY "Users can upload their own contracts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);

-- SELECT: users can only read their own files
CREATE POLICY "Users can read their own contracts"
ON storage.objects FOR SELECT
USING (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);

-- DELETE: users can only delete their own files
CREATE POLICY "Users can delete their own contracts"
ON storage.objects FOR DELETE
USING (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

### Entity Relationship Diagram

```
auth.users
    │
    ├─── contracts ──────────────── key_terms
    │         │                     (contract_id FK)
    │         │
    │         ├─── custom_key_terms
    │         │    (contract_id FK)
    │         │
    │         ├─── chat_sessions ── chat_messages
    │         │    (contract_id FK) (session_id FK)
    │         │
    │         ├─── user_feedback
    │         │    (contract_id FK)
    │         │
    │         └─── [storage.objects]
    │              path: contracts/{user_id}/{contract_id}/...
    │
    └─── term_corrections
         (key_term_id FK → key_terms)
```

---

## 8. AI Architecture

### Model Configuration

| Parameter | Extraction | Chat |
|---|---|---|
| Provider | OpenAI API (server-side) | OpenAI API (server-side) |
| Model | `gpt-4o` | `gpt-4o` |
| Response format | `json_object` (JSON mode) | Free text |
| Temperature | `0.1` | `0.4` |
| Max output tokens | `2,000` | `1,000` |
| Context window | 128k tokens | 128k tokens |
| Retry strategy | 3-attempt exponential backoff | 3-attempt exponential backoff |

### Key Term Extraction

**Technique:** Few-shot prompting — 3 labelled NDA examples + 3 labelled MSA examples embedded in the system prompt.

**Standard term lists:**

| Contract Type | Terms |
|---|---|
| NDA (10 terms) | Parties, Effective Date, Confidentiality Obligations, Permitted Disclosures, Term & Duration, Governing Law, Jurisdiction, IP Ownership, Non-Solicitation, Breach & Remedy |
| MSA (12 terms) | Parties, Service Scope, Payment Terms, Invoice Schedule, Late Payment Penalty, Liability Cap, Indemnification, IP Ownership, Termination Clause, Governing Law, Dispute Resolution, Notice Period |

**Custom terms:** Zero-shot; appended to the standard term list in the prompt. Same output schema. Maximum 5 custom terms per analysis.

**Output schema (JSON array):**
```json
[
  {
    "term_name": "string",
    "value": "string",
    "page_number": 3,
    "confidence_score": 0.87,
    "source_sentence": "string — verbatim sentence from contract"
  }
]
```

**Error recovery:** If JSON parse fails → single automatic retry with prompt: `"Your previous response was not valid JSON. Return only the JSON array, no explanation."` If second attempt fails → return 502 to client with retry CTA.

### Contract Chat

**Technique:** Full-context RAG (no chunking at MVP). The entire `contract_text` is passed on every turn.

**System prompt template:**
```
You are a contract review assistant. Answer questions ONLY from the document text 
provided below. If the answer is not in the document, respond: 
"I cannot find this in the document."

Every response MUST end with a citation in the format: [Page X]

Begin your response with: "Based on the document..."

CONTRACT TEXT:
{contract_text}
```

**Conversation history:** All messages for the session are fetched from `chat_messages` (ascending order, up to 200 messages) and passed as the `messages` array. This enables memory-style questions.

**Query classification:** The backend classifies each query as `contract` / `history` / `both` to adjust context inclusion — handled without an additional API call via keyword heuristics.

### Confidence Scoring

Confidence is self-reported by the model inline within the extraction response (no second API call). Scores are validated as floats between 0.0 and 1.0.

**UI colour mapping:**
| Score range | Badge colour | Warning |
|---|---|---|
| ≥ 0.80 | Green | None |
| 0.50 – 0.79 | Amber | None |
| < 0.50 | Red | ⚠️ icon + non-dismissible tooltip: "Low confidence — we recommend verifying this in the document directly." |

### Hallucination Guardrails

| Layer | Guardrail |
|---|---|
| Extraction | JSON mode enforced; temperature 0.1; source sentence required per term; low-confidence flagging |
| Chat | System prompt: document-only answers; mandatory `[Page X]` citation; "Based on the document…" prefix |
| UI | Inline edit lets user correct any term; original AI value preserved in `key_terms.original_value`; PDF viewer auto-highlights low-confidence term pages |
| Disclaimer | "This is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer." — shown on every results page, non-removable |
| Testing | Automated regression test: feed a question about a topic not in the document; assert response contains "I cannot find this in the document" |

### Cost Controls

| Control | Detail |
|---|---|
| Token limit per contract | Reject contracts > 15,000 tokens before calling OpenAI |
| Max output tokens | 2,000 (extraction); 1,000 (chat) — prevents runaway response costs |
| Custom term limit | Maximum 5 per analysis — caps prompt growth |
| Cost target | ≤ $0.20 per extraction (20-page contract ≈ 15,000 input + 1,500 output tokens ≈ $0.097 at current GPT-4o pricing) |
| Monitoring | OpenAI usage dashboard; alert at 80% of monthly budget |

---

## 9. API Specification

All routes are Next.js API Routes under `app/api/`. All routes require a valid Supabase session (checked via `createServerClient` from `@supabase/ssr`). Unauthenticated requests return `401`.

---

### `POST /api/upload`

**Purpose:** Receive PDF binary, extract text server-side, store contract record in DB, upload PDF to Storage (non-blocking).

**Auth:** Required

**Request:**
```
Content-Type: multipart/form-data
Fields:
  file          File     PDF binary (required)
  contract_type string   "nda" | "msa" (required)
  custom_terms  string[] JSON-encoded array of up to 5 term name strings (optional)
```

**Validation:**
- File size ≤ 10 MB (reject with 400: `"File exceeds 10 MB limit"`)
- File type must be `application/pdf` (reject with 400: `"Only PDF files are accepted"`)
- `contract_type` must be `"nda"` or `"msa"` (reject with 400)
- `custom_terms` array length ≤ 5 (reject with 400: `"Maximum 5 custom terms allowed"`)

**Processing:**
1. Run `pdfjs-dist` text extraction; parse `[PAGE N]` markers
2. Validate: page count ≤ 20; extracted text ≥ 100 words; token count ≤ 15,000
3. INSERT into `contracts`; INSERT into `custom_key_terms` for each custom term
4. Non-blocking: upload PDF binary to `contracts/{user_id}/{contract_id}/{filename}.pdf` in Storage; update `contracts.file_path` on success

**Response (201):**
```json
{
  "contract_id": "uuid",
  "page_count": 12,
  "token_count": 8420,
  "custom_terms_saved": ["Non-compete radius"]
}
```

**Error responses:**
| Code | Condition |
|---|---|
| 400 | File too large, not a PDF, invalid contract_type, too many custom terms |
| 401 | Missing or invalid session |
| 422 | Scanned PDF (text < 100 words) or contract too long (> 15,000 tokens) |
| 500 | Unexpected server error |

---

### `POST /api/process`

**Purpose:** Run GPT-4o key-term extraction on a contract already uploaded. Writes results to `key_terms`.

**Auth:** Required

**Request (JSON):**
```json
{
  "contract_id": "uuid"
}
```

**Validation:**
- `contract_id` must exist and belong to `auth.uid()`
- `contracts.status` must be `'pending'` or `'error'` (prevent double-processing)

**Processing:**
1. Read `contract_text`, `contract_type`, and custom terms from DB
2. Build few-shot extraction prompt
3. Call GPT-4o with JSON mode; parse response; retry once on parse failure
4. INSERT all terms into `key_terms`
5. UPDATE `contracts.status = 'completed'`
6. On OpenAI failure after retries: UPDATE `contracts.status = 'error'`

**Response (200):**
```json
{
  "contract_id": "uuid",
  "terms_extracted": 11,
  "status": "completed"
}
```

**Error responses:**
| Code | Condition |
|---|---|
| 400 | Contract already processed |
| 401 | Unauthenticated |
| 404 | Contract not found or not owned by user |
| 502 | OpenAI returned invalid JSON after retry |
| 503 | OpenAI API unavailable after 3 retries |

---

### `GET /api/contracts/[id]`

**Purpose:** Fetch full contract data for the results page — contract metadata, key terms, and a 1-hour signed URL for the PDF viewer.

**Auth:** Required

**Path param:** `id` — contract UUID

**Response (200):**
```json
{
  "contract": {
    "id": "uuid",
    "file_name": "NDA_Acme_2026.pdf",
    "contract_type": "nda",
    "status": "completed",
    "page_count": 12,
    "created_at": "2026-08-12T10:00:00Z"
  },
  "key_terms": [
    {
      "id": "uuid",
      "term_name": "Governing Law",
      "value": "New York",
      "page_number": 8,
      "confidence_score": 0.93,
      "source_sentence": "This Agreement shall be governed by the laws of the State of New York.",
      "is_edited": false,
      "is_manual": false
    }
  ],
  "signed_url": "https://supabase.../storage/v1/...",
  "contract_text": "... [PAGE 1] ... [PAGE 2] ..."
}
```

**Notes:**
- `signed_url` is null if `file_path` is null (Storage upload had previously failed); frontend renders `TextViewerFallback`
- `contract_text` always present; used by `TextViewerFallback` and as backup

**Error responses:** `401`, `404`

---

### `PATCH /api/terms/[id]`

**Purpose:** User inline-edits an extracted term. Saves corrected value; logs correction for feedback loop.

**Auth:** Required

**Path param:** `id` — key_term UUID

**Request (JSON):**
```json
{
  "value": "California"
}
```

**Processing:**
1. Verify `key_terms.user_id = auth.uid()`
2. If `key_terms.is_edited = false`: copy current `value` to `original_value`, set `is_edited = true`
3. UPDATE `key_terms.value` with new value
4. INSERT into `term_corrections` (original_value, corrected_value)

**Response (200):**
```json
{
  "id": "uuid",
  "value": "California",
  "is_edited": true,
  "original_value": "New York"
}
```

**Error responses:** `400` (empty value), `401`, `404`

---

### `POST /api/chat`

**Purpose:** Send user question to GPT-4o with full contract context and conversation history; save messages to DB.

**Auth:** Required

**Request (JSON):**
```json
{
  "contract_id": "uuid",
  "question": "What happens if I breach the NDA?"
}
```

**Processing:**
1. Fetch `contract_text` from `contracts` (verify ownership)
2. Fetch or create `chat_sessions` row for this contract
3. Fetch all `chat_messages` for session (ASC by `created_at`, up to 200)
4. INSERT user message into `chat_messages`
5. Classify query type (`contract` / `history` / `both`)
6. Build GPT-4o messages array: system prompt + contract text + conversation history + new user message
7. Call GPT-4o (temperature 0.4, max 1,000 tokens)
8. INSERT assistant message into `chat_messages`

**Response (200):**
```json
{
  "session_id": "uuid",
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "Based on the document, if you breach the NDA... [Page 4]",
    "created_at": "2026-08-12T10:05:00Z"
  }
}
```

**Error responses:** `400` (empty question), `401`, `404` (contract not found), `503` (OpenAI unavailable)

---

### `GET /api/dashboard`

**Purpose:** Return paginated, sortable list of the authenticated user's contracts for the dashboard.

**Auth:** Required

**Query params:**
| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | integer | `1` | 1-indexed |
| `limit` | integer | `20` | Max 50 |
| `sort_by` | string | `created_at` | `created_at` \| `file_name` \| `contract_type` |
| `sort_dir` | string | `desc` | `asc` \| `desc` |

**Response (200):**
```json
{
  "contracts": [
    {
      "id": "uuid",
      "file_name": "NDA_Acme_2026.pdf",
      "contract_type": "nda",
      "status": "completed",
      "page_count": 12,
      "created_at": "2026-08-12T10:00:00Z"
    }
  ],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

**Error responses:** `401`

---

### `POST /api/feedback`

**Purpose:** Save thumbs up/down feedback (and optional comment) for a contract review.

**Auth:** Required

**Request (JSON):**
```json
{
  "contract_id": "uuid",
  "rating": "up",
  "comment": "Missed the auto-renewal clause"
}
```

**Validation:**
- `rating` must be `"up"` or `"down"`
- `comment` optional; max 1,000 characters
- One feedback record per `(contract_id, user_id)` — UPSERT on conflict

**Response (201):**
```json
{
  "id": "uuid",
  "rating": "up",
  "created_at": "2026-08-12T10:10:00Z"
}
```

**Error responses:** `400` (invalid rating), `401`, `404`

---

## 10. Feature Breakdown

### Phase 1 — P0 (MVP Core) — Weeks 1–5

| Story | Feature | Acceptance Criteria | Dependencies |
|---|---|---|---|
| US-001 | User authentication (sign up / sign in / sign out) | Auth flow ≤ 10 seconds; redirect to dashboard on success; clear error on invalid credentials | Supabase Auth configured |
| US-002 | PDF upload + text extraction | Accepts ≤ 10 MB / ≤ 20 pages; rejects scanned PDFs; extraction ≤ 30s P95; `contract_text` stored with `[PAGE N]` markers | `pdfjs-dist` server-side; Supabase DB |
| US-003 | Page number attribution per key term | Each term displays 1-indexed page number; clicking page number navigates viewer | Results page; PDF viewer |
| US-004 | Confidence score display per term | Score shown 0–100%; green/amber/red colour coding | Key terms panel component |
| FR-11 | Low-confidence warnings | Terms < 50% show ⚠️ icon + non-dismissible tooltip | `confidence-badge.tsx` |
| US-005 | Custom key term addition | Up to 5 terms; appear in preview with "Custom" badge; results include same data structure | `custom-term-adder.tsx`; extraction prompt builder |
| FR-03 | Server-side text extraction stored once | `contract_text` in DB; no re-download for processing or chat | `/api/upload` |
| FR-13 | RLS on all tables | Users can only read/write their own data; RLS unit tests pass | Supabase SQL setup |

### Phase 2 — P1 (Enriched Experience) — Weeks 6–11

| Story | Feature | Acceptance Criteria | Dependencies |
|---|---|---|---|
| US-006 | Inline PDF viewer | PDF.js renders all pages; scroll + zoom; highlighted term references clickable | Signed URL from Storage; `pdf-viewer.tsx` |
| FR-06 | Text viewer fallback | Renders when Storage unavailable; same `targetPage` interface as PDF viewer | `text-viewer-fallback.tsx`; `[PAGE N]` markers in `contract_text` |
| US-007 | Contract chat (Q&A) | Chat responds ≤ 15s P95; all responses grounded in document; mandatory `[Page X]` citation | `/api/chat`; `chat-interface.tsx` |
| US-012 | Persistent chat history | Reopening results page loads previous chat session | `chat_sessions` + `chat_messages` tables |
| US-008 | Dashboard with contract history | Shows file name, type, date, status; sortable; clickable rows open results | `/api/dashboard`; `dashboard-table.tsx` |
| US-009 | Inline key term editing | Edit saves within 2 seconds; "Edited" badge shown; original AI value preserved | `PATCH /api/terms/[id]`; `term_corrections` table |

### Phase 3 — P2 (Post-Launch) — Weeks 12+

| Story | Feature | Acceptance Criteria | Dependencies |
|---|---|---|---|
| US-010 | Feedback submission | Thumbs up/down + optional comment; saved to `user_feedback` | `feedback-widget.tsx`; `/api/feedback` |
| US-011 | Export key terms to CSV / PDF | Export generates and downloads within 5 seconds | CSV: browser-side `Blob`; PDF: `@react-pdf/renderer` or equivalent |

---

## 11. Folder Structure

```
contractiq/                          # Next.js 14 App Router project root
│
├── app/
│   ├── layout.tsx                   # Root layout: Supabase session provider, global nav, fonts
│   ├── page.tsx                     # Landing page (/)
│   ├── globals.css                  # Tailwind base + design system custom properties
│   │
│   ├── (auth)/                      # Auth route group (no shared layout with main app)
│   │   ├── sign-in/
│   │   │   └── page.tsx
│   │   └── sign-up/
│   │       └── page.tsx
│   │
│   ├── dashboard/
│   │   └── page.tsx                 # Dashboard — server component; fetches contracts list
│   │
│   ├── upload/
│   │   └── page.tsx                 # Upload + pre-processing page — client component
│   │
│   ├── results/
│   │   └── [id]/
│   │       └── page.tsx             # Results page — server component fetches contract; mounts viewers + panel
│   │
│   └── api/
│       ├── upload/
│       │   └── route.ts             # POST /api/upload
│       ├── process/
│       │   └── route.ts             # POST /api/process
│       ├── contracts/
│       │   └── [id]/
│       │       └── route.ts         # GET /api/contracts/[id]
│       ├── terms/
│       │   └── [id]/
│       │       └── route.ts         # PATCH /api/terms/[id]
│       ├── chat/
│       │   └── route.ts             # POST /api/chat
│       ├── dashboard/
│       │   └── route.ts             # GET /api/dashboard
│       └── feedback/
│           └── route.ts             # POST /api/feedback
│
├── components/
│   ├── ui/                          # Generic, reusable UI primitives
│   │   ├── button.tsx
│   │   ├── badge.tsx                # Used for confidence colour badges + "Custom" / "Edited" labels
│   │   ├── tooltip.tsx
│   │   ├── modal.tsx
│   │   ├── skeleton.tsx             # Loading placeholders
│   │   └── error-banner.tsx        # Full-width dismissible error alerts
│   │
│   ├── auth/
│   │   ├── sign-in-form.tsx
│   │   └── sign-up-form.tsx
│   │
│   ├── dashboard/
│   │   ├── dashboard-table.tsx      # Sortable contract list table
│   │   ├── summary-cards.tsx        # Total contracts + by-type breakdown cards
│   │   └── empty-state.tsx          # Illustration + CTA when no contracts exist
│   │
│   ├── contract/
│   │   ├── contract-uploader.tsx    # Drag-and-drop + file picker; client-side validation
│   │   ├── contract-type-select.tsx # NDA / MSA dropdown
│   │   ├── term-preview-card.tsx    # Pre-processing preview of terms to be extracted
│   │   ├── custom-term-adder.tsx    # "+ Add Key Term" input with 5-term limit enforcement
│   │   ├── process-button.tsx       # Triggers upload + process; shows step progress
│   │   ├── key-terms-panel.tsx      # Right panel wrapper on results page
│   │   ├── term-card.tsx            # Individual term: name | value | page | confidence | source
│   │   ├── term-inline-editor.tsx   # Inline edit input + save/cancel; shows "Edited" badge
│   │   ├── confidence-badge.tsx     # Green/amber/red badge; ⚠️ icon + tooltip below 50%
│   │   ├── source-tooltip.tsx       # Expandable "Why?" showing source_sentence
│   │   ├── pdf-viewer.tsx           # PDF.js client wrapper; accepts targetPage prop
│   │   └── text-viewer-fallback.tsx # Parses [PAGE N] markers; same targetPage interface
│   │
│   └── chat/
│       ├── chat-interface.tsx       # Full chat panel; loads history + handles send
│       └── chat-message.tsx         # Single message bubble; page citation link
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # createBrowserClient() for client components
│   │   ├── server.ts                # createServerClient() for API routes + server components
│   │   └── middleware.ts            # Auth session refresh middleware
│   │
│   ├── openai/
│   │   ├── client.ts                # OpenAI SDK instance (server-side only)
│   │   ├── extraction.ts            # buildExtractionPrompt(); callExtraction(); parseExtractionResponse()
│   │   └── chat.ts                  # buildChatMessages(); classifyQuery(); callChat()
│   │
│   └── pdf/
│       ├── extractor.ts             # extractTextFromPDF(buffer): string — pdfjs-dist wrapper with [PAGE N] markers
│       └── validator.ts             # validatePDF(text, pageCount): ValidationResult — checks word count, token count, page limit
│
├── hooks/
│   ├── useContract.ts               # Client-side contract + key terms state; handles optimistic term edits
│   ├── useChat.ts                   # Chat message state; handles send + history load
│   └── useDashboard.ts              # Fetches + sorts contracts list; handles pagination
│
├── types/
│   ├── contract.ts                  # Contract, KeyTerm, CustomKeyTerm TypeScript interfaces
│   ├── chat.ts                      # ChatSession, ChatMessage interfaces
│   └── api.ts                       # API request/response shape types for all routes
│
├── middleware.ts                    # Next.js middleware — Supabase session refresh; redirect unauthenticated users
│
├── .env.local                       # Local env vars (gitignored)
├── .env.example                     # All required env vars with descriptions
├── next.config.ts                   # Next.js config — PDF.js worker handling
├── tailwind.config.ts               # Design system token mapping
├── tsconfig.json
└── package.json
```

---

## 12. Naming Conventions

### Files and Folders

| Type | Convention | Example |
|---|---|---|
| Page files | `page.tsx` (required by Next.js) | `app/dashboard/page.tsx` |
| API routes | `route.ts` (required by Next.js) | `app/api/upload/route.ts` |
| Components | `kebab-case.tsx` | `key-terms-panel.tsx`, `confidence-badge.tsx` |
| Utility / lib files | `camelCase.ts` | `extractor.ts`, `buildExtractionPrompt` |
| Hook files | `camelCase.ts` with `use` prefix | `useContract.ts`, `useChat.ts` |
| Type definition files | `camelCase.ts` | `contract.ts`, `api.ts` |

### Components

- `PascalCase` for React components
- Examples: `KeyTermsPanel`, `PDFViewer`, `TextViewerFallback`, `ConfidenceBadge`, `DashboardTable`

### Hooks

- `use` + `PascalCase` for all custom hooks
- Examples: `useContract`, `useChat`, `useDashboard`

### API Routes

- `app/api/[resource]/route.ts` — one file per resource
- Path segments: lowercase, hyphenated (`/api/key-terms/[id]` if needed)

### Database Tables and Columns

| Convention | Example |
|---|---|
| Tables: `snake_case` plural | `key_terms`, `chat_messages`, `user_feedback`, `term_corrections` |
| Columns: `snake_case` | `contract_type`, `confidence_score`, `source_sentence`, `is_edited` |
| Boolean columns: `is_` prefix | `is_edited`, `is_manual` |
| Timestamp columns | `created_at`, `last_accessed_at` |
| Foreign keys: `{table_singular}_id` | `contract_id`, `session_id`, `key_term_id` |

### Environment Variables

| Type | Convention | Example |
|---|---|---|
| Client-safe (public) | `NEXT_PUBLIC_` prefix | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Server-only secrets | No prefix; never set as `NEXT_PUBLIC_` | `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

### TypeScript Interfaces

- `PascalCase` for interfaces and types
- Suffix `Props` for React component prop types
- Examples: `Contract`, `KeyTerm`, `ChatMessage`, `TermCardProps`, `UploadApiResponse`

### Constants

- `SCREAMING_SNAKE_CASE` for module-level constants
- Examples: `MAX_FILE_SIZE_MB`, `MAX_CUSTOM_TERMS`, `MAX_CONTRACT_TOKENS`

---

## 13. Testing Strategy

### Unit Tests — `vitest`

**Coverage targets:** ≥ 80% line coverage on `lib/` and `types/`

| Test file | What it tests |
|---|---|
| `lib/pdf/extractor.test.ts` | Text extraction output: `[PAGE N]` marker insertion; word count calculation |
| `lib/pdf/validator.test.ts` | Page count limit; token count limit; scanned PDF detection (< 100 words) |
| `lib/openai/extraction.test.ts` | `buildExtractionPrompt()` output structure; JSON parse + retry logic; confidence score range validation |
| `lib/openai/chat.test.ts` | `buildChatMessages()` ordering; `classifyQuery()` returns `contract`/`history`/`both` |
| `components/contract/confidence-badge.test.tsx` | Renders green for ≥ 0.80; amber for 0.50–0.79; red + ⚠️ for < 0.50 |

### Integration Tests — `vitest` + local Supabase (`supabase start`)

**Coverage targets:** All API routes tested against real local Supabase instance

| Test file | What it tests |
|---|---|
| `app/api/upload/route.test.ts` | File size rejection; page count rejection; scanned PDF rejection; successful insert into `contracts` |
| `app/api/process/route.test.ts` | Successful extraction writes all term fields to `key_terms`; OpenAI mock returns invalid JSON → retry → success |
| `app/api/terms/[id]/route.test.ts` | PATCH saves new value; `original_value` populated; `term_corrections` row inserted |
| `app/api/chat/route.test.ts` | User + assistant messages saved; history loaded on subsequent call |
| `app/api/feedback/route.test.ts` | Feedback saved; UPSERT on duplicate `(contract_id, user_id)` |
| `lib/supabase/rls.test.ts` | Cross-user access attempt returns no rows on all tables |

### End-to-End Tests — `Playwright`

**Critical paths:**

| Test | Flow |
|---|---|
| `e2e/auth.spec.ts` | Sign up → email verify → redirect to dashboard → sign out → sign in |
| `e2e/upload-and-review.spec.ts` | Upload valid NDA PDF → wait for results page → assert all 10 standard terms visible → assert page numbers displayed → assert confidence scores colour-coded |
| `e2e/custom-terms.spec.ts` | Upload NDA → add 2 custom terms → process → assert custom terms appear with "Custom" badge |
| `e2e/chat.spec.ts` | On results page → open chat → send question → assert response contains `[Page` → reload page → assert message persists |
| `e2e/inline-edit.spec.ts` | Click term → edit value → save → assert "Edited" badge shown → assert `original_value` preserved |
| `e2e/dashboard.spec.ts` | After upload → dashboard shows contract row → click row → opens results page |
| `e2e/hallucination-guard.spec.ts` | Send question about topic not in document → assert response contains "I cannot find this in the document" |
| `e2e/scanned-pdf.spec.ts` | Upload image-only PDF → assert error message "Scanned PDFs are not supported yet" |

### Performance Test

- Tool: `k6`
- Scenario: 100 concurrent `POST /api/process` requests with 10-page test NDA
- Assertion: P95 response time ≤ 30 seconds; no 5xx errors

---

## 14. Specs to Implementation Mapping

This table maps each PRD user story to the exact implementation files that fulfil it.

| Story ID | Feature | API Route | Components | Hook | DB Tables |
|---|---|---|---|---|---|
| US-001 | Auth (sign up / sign in / sign out) | Supabase Auth (no custom route) | `sign-in-form.tsx`, `sign-up-form.tsx` | — | `auth.users` (managed by Supabase) |
| US-002 | PDF upload + text extraction | `POST /api/upload` | `contract-uploader.tsx`, `contract-type-select.tsx`, `process-button.tsx` | — | `contracts`, `custom_key_terms` |
| US-003 | Page number attribution | `GET /api/contracts/[id]` | `term-card.tsx`, `pdf-viewer.tsx`, `text-viewer-fallback.tsx` | `useContract` | `key_terms.page_number` |
| US-004 | Confidence score display | `GET /api/contracts/[id]` | `confidence-badge.tsx`, `term-card.tsx` | `useContract` | `key_terms.confidence_score` |
| FR-11 | Low-confidence warnings | — (client-side logic) | `confidence-badge.tsx` | — | `key_terms.confidence_score` |
| US-005 | Custom key term addition | `POST /api/upload`, `POST /api/process` | `custom-term-adder.tsx`, `term-preview-card.tsx` | — | `custom_key_terms`, `key_terms.is_manual` |
| US-006 | Inline PDF viewer | `GET /api/contracts/[id]` (signed URL) | `pdf-viewer.tsx` | `useContract` | `contracts.file_path` |
| FR-06 | Text viewer fallback | `GET /api/contracts/[id]` (contract_text) | `text-viewer-fallback.tsx` | `useContract` | `contracts.contract_text` |
| US-007 | Contract chat (Q&A) | `POST /api/chat` | `chat-interface.tsx`, `chat-message.tsx` | `useChat` | `chat_sessions`, `chat_messages` |
| US-008 | Dashboard + history | `GET /api/dashboard` | `dashboard-table.tsx`, `summary-cards.tsx`, `empty-state.tsx` | `useDashboard` | `contracts` |
| US-009 | Inline key term editing | `PATCH /api/terms/[id]` | `term-inline-editor.tsx`, `term-card.tsx` | `useContract` | `key_terms.is_edited`, `key_terms.original_value`, `term_corrections` |
| US-010 | Feedback submission | `POST /api/feedback` | `feedback-widget.tsx` | — | `user_feedback` |
| US-011 | Export to CSV / PDF | Client-side (Phase 3) | `export-button.tsx` (Phase 3) | — | `key_terms` (read) |
| US-012 | Persistent chat history | `POST /api/chat`, `GET /api/contracts/[id]` | `chat-interface.tsx` | `useChat` | `chat_sessions`, `chat_messages` |
| FR-03 | Server-side text extraction stored once | `POST /api/upload` | — | — | `contracts.contract_text` |
| FR-13 | RLS on all tables | — (Supabase policies) | — | — | All tables |
| FR-14 | Single paste-and-run SQL file | — | — | — | `docs/specs/supabase-schema.sql` (Stage 2) |

### Full flow trace — US-002 (PDF Upload + Extraction) example:

```
User selects PDF on /upload
  → contract-uploader.tsx validates size/type client-side
    → process-button.tsx calls POST /api/upload
      → app/api/upload/route.ts
        → lib/pdf/extractor.ts: extractTextFromPDF(buffer)
        → lib/pdf/validator.ts: validatePDF(text, pageCount)
        → supabase/server.ts: INSERT INTO contracts
        → supabase Storage upload (non-blocking)
      → returns { contract_id }
    → process-button.tsx calls POST /api/process
      → app/api/process/route.ts
        → lib/openai/extraction.ts: buildExtractionPrompt()
        → lib/openai/extraction.ts: callExtraction() → OpenAI API
        → lib/openai/extraction.ts: parseExtractionResponse()
        → supabase/server.ts: INSERT INTO key_terms (batch)
        → UPDATE contracts.status = 'completed'
      → returns { terms_extracted, status }
    → process-button.tsx navigates to /results/[contract_id]
      → app/results/[id]/page.tsx: GET /api/contracts/[id]
        → key-terms-panel.tsx renders all TermCard components
        → pdf-viewer.tsx renders PDF (or text-viewer-fallback.tsx if no signed URL)
```

---

*Engineering document complete. Review all sections and confirm you are ready to proceed to Stage 2 (Implementation Specs).*
