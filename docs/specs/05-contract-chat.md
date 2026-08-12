# Spec 05 — Contract Chat (Q&A) + Persistent History

**Stories:** US-007, US-012  
**Priority:** P1  
**Files touched:** `app/api/chat/route.ts`, `lib/openai/chat.ts`, `components/chat/chat-interface.tsx`, `components/chat/chat-message.tsx`

---

## What to Build

`POST /api/chat` receives a `contract_id` and `question`, looks up (or creates) the user's chat session for that contract, appends the user message to history, calls GPT-4o with the full contract text as context, streams or returns the assistant reply, and persists both messages to `chat_messages`. `GET /api/contracts/[id]` already returns the session and initial messages (Spec 04), so the chat component loads history without a second fetch.

---

## Acceptance Criteria

- [ ] Chat panel shows all previous messages when results page reloads
- [ ] User message appears immediately in the UI before the API responds (optimistic render)
- [ ] AI response always includes at least one `[Page X]` citation when the answer references a specific clause
- [ ] Clicking `[Page X]` chip in an AI response scrolls the PDF/text viewer to that page
- [ ] Sending an empty message is a no-op
- [ ] Question > 2,000 characters blocked client-side with character counter
- [ ] If OpenAI times out (> 15 s), chat panel shows inline error banner with Retry button
- [ ] `chat_sessions` row is created on first message; subsequent sends reuse it
- [ ] Chat session is one-per-contract-per-user (`UNIQUE(contract_id, user_id)`)

---

## Database

### Tables Used

**`chat_sessions`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `contract_id` | uuid FK → contracts | |
| `user_id` | uuid FK → auth.users | |
| `created_at` | timestamptz | |

Unique constraint: `(contract_id, user_id)` — enforced at DB level.

**`chat_messages`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK → chat_sessions | |
| `user_id` | uuid FK → auth.users | |
| `role` | text CHECK IN ('user','assistant') | |
| `content` | text | |
| `created_at` | timestamptz | ordered ASC = conversation order |

### DB Tasks (per chat exchange)

```sql
-- 1. Upsert session (returns existing or new session id)
INSERT INTO chat_sessions (contract_id, user_id)
VALUES ($contract_id, $user_id)
ON CONFLICT (contract_id, user_id) DO UPDATE SET contract_id = EXCLUDED.contract_id
RETURNING id;

-- 2. Insert user message
INSERT INTO chat_messages (session_id, user_id, role, content)
VALUES ($session_id, $user_id, 'user', $question);

-- 3. Fetch recent history for context window (last 20 messages)
SELECT role, content FROM chat_messages
WHERE session_id = $session_id
ORDER BY created_at ASC;

-- 4. Insert assistant reply
INSERT INTO chat_messages (session_id, user_id, role, content)
VALUES ($session_id, $user_id, 'assistant', $reply);
```

---

## `app/api/chat/route.ts` — Full Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildChatResponse } from '@/lib/openai/chat'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { contract_id?: string; question?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { contract_id, question } = body
  if (!contract_id) return NextResponse.json({ error: 'contract_id is required' }, { status: 400 })
  if (!question?.trim()) return NextResponse.json({ error: 'question is required' }, { status: 400 })
  if (question.length > 2000) return NextResponse.json({ error: 'Question exceeds 2,000 characters' }, { status: 400 })

  // Verify contract ownership + fetch text
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, contract_text, file_name, contract_type, status')
    .eq('id', contract_id)
    .eq('user_id', user.id)
    .single()

  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
  if (contract.status !== 'completed') {
    return NextResponse.json({ error: 'Contract has not been processed yet' }, { status: 400 })
  }

  // Upsert chat session
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .upsert(
      { contract_id, user_id: user.id },
      { onConflict: 'contract_id,user_id', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (sessionError || !session) {
    console.error('chat_sessions upsert error:', sessionError)
    return NextResponse.json({ error: 'Failed to create chat session' }, { status: 500 })
  }

  const session_id = session.id

  // Fetch recent message history (last 20 exchanges = 40 messages)
  const { data: historyRows } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(40)

  const history = (historyRows ?? []) as { role: 'user' | 'assistant'; content: string }[]

  // Insert user message
  await supabase.from('chat_messages').insert({
    session_id,
    user_id: user.id,
    role: 'user',
    content: question.trim(),
  })

  // Call GPT-4o
  let reply: string
  try {
    reply = await buildChatResponse(contract.contract_text, history, question.trim())
  } catch (err) {
    console.error('Chat OpenAI error:', err)
    return NextResponse.json({ error: 'AI response failed — please try again' }, { status: 502 })
  }

  // Insert assistant message
  const { data: assistantMessage } = await supabase
    .from('chat_messages')
    .insert({
      session_id,
      user_id: user.id,
      role: 'assistant',
      content: reply,
    })
    .select('id, role, content, created_at')
    .single()

  return NextResponse.json({
    session_id,
    message: assistantMessage,
  })
}
```

---

## `lib/openai/chat.ts` — Chat Prompt + OpenAI Call

```typescript
import { openai } from './client'

const CHAT_SYSTEM_PROMPT = `You are ContractIQ, an AI assistant that answers questions about legal contracts.

Rules:
1. Answer ONLY from the provided contract text. Do not invent clauses or reference knowledge outside the document.
2. Every answer that references a specific clause, obligation, or date MUST include a page citation in the format [Page X].
3. If the question cannot be answered from the contract text, respond: "I couldn't find that information in this contract."
4. Be concise and precise. Use plain English — avoid legal jargon where possible.
5. If a question asks for legal advice, clarify that you provide information only, not legal advice.
6. Structure multi-part answers with short bullet points.`

export async function buildChatResponse(
  contractText: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
): Promise<string> {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content: `${CHAT_SYSTEM_PROMPT}\n\nCONTRACT TEXT:\n${contractText}`,
    },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: question },
  ]

  const response = await openai.chat.completions.create({
    model:       'gpt-4o',
    temperature: 0.4,
    max_tokens:  1000,
    messages,
  })

  return response.choices[0]?.message?.content ?? 'No response generated.'
}
```

---

## State Management — `useChat` Hook

```typescript
// hooks/use-chat.ts
'use client'
import { useState } from 'react'

export interface ChatMessage {
  id:         string
  role:       'user' | 'assistant'
  content:    string
  created_at: string
}

interface UseChatOptions {
  contractId:       string
  initialSessionId: string | null
  initialMessages:  ChatMessage[]
  onPageCite:       (page: number) => void
}

export function useChat({ contractId, initialSessionId, initialMessages, onPageCite }: UseChatOptions) {
  const [messages, setMessages]     = useState<ChatMessage[]>(initialMessages)
  const [sessionId, setSessionId]   = useState<string | null>(initialSessionId)
  const [isLoading, setIsLoading]   = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function sendMessage(question: string) {
    if (!question.trim() || isLoading) return
    setError(null)

    // Optimistic user message
    const optimisticMsg: ChatMessage = {
      id:         `optimistic-${Date.now()}`,
      role:       'user',
      content:    question.trim(),
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimisticMsg])
    setIsLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contract_id: contractId, question: question.trim() }),
        signal:  AbortSignal.timeout(15_000),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Chat request failed')
      }

      const data = await res.json()
      if (!sessionId) setSessionId(data.session_id)

      setMessages(prev => [...prev, data.message as ChatMessage])
    } catch (err) {
      const message = err instanceof Error && err.name === 'TimeoutError'
        ? 'Taking too long — please try again.'
        : err instanceof Error ? err.message : 'Something went wrong.'
      setError(message)
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id))
    } finally {
      setIsLoading(false)
    }
  }

  return { messages, sessionId, isLoading, error, sendMessage }
}
```

---

## `components/chat/chat-interface.tsx` — Full Implementation

```typescript
'use client'
import { useRef, useEffect, useState } from 'react'
import { useChat, type ChatMessage as ChatMsg } from '@/hooks/use-chat'
import { ChatMessage } from './chat-message'

interface ChatInterfaceProps {
  contractId:       string
  initialSessionId: string | null
  initialMessages:  ChatMsg[]
  onPageCite:       (page: number) => void
}

export function ChatInterface({ contractId, initialSessionId, initialMessages, onPageCite }: ChatInterfaceProps) {
  const { messages, isLoading, error, sendMessage } = useChat({
    contractId,
    initialSessionId,
    initialMessages,
    onPageCite,
  })

  const [input, setInput]         = useState('')
  const bottomRef                  = useRef<HTMLDivElement>(null)
  const textareaRef                = useRef<HTMLTextAreaElement>(null)
  const MAX_CHARS                  = 2000

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  async function handleSend() {
    const q = input.trim()
    if (!q || isLoading || q.length > MAX_CHARS) return
    setInput('')
    await sendMessage(q)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const charsLeft = MAX_CHARS - input.length
  const overLimit = charsLeft < 0

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-sm text-[#4A4C4F] text-center mt-8">
            Ask anything about this contract
          </p>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} onPageCite={onPageCite} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-[#4A4C4F]">
            <span className="inline-block w-4 h-4 border-2 border-[#115ACB] border-t-transparent rounded-full animate-spin" />
            Analysing…
          </div>
        )}
        {error && (
          <div className="rounded-md bg-[#FAEBEB] border border-[#EAA2A3] px-3 py-2 text-sm text-[#581618] flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              onClick={() => sendMessage(messages[messages.length - 1]?.content ?? '')}
              className="text-xs font-medium text-[#D13438] hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[#E5E7EB] px-4 py-3 bg-white">
        <div className="flex flex-col gap-1">
          <textarea
            ref={textareaRef}
            rows={3}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about this contract…"
            className="input-base resize-none text-sm"
            disabled={isLoading}
          />
          <div className="flex items-center justify-between">
            <span className={`text-xs ${overLimit ? 'text-[#D13438]' : 'text-[#4A4C4F]'}`}>
              {charsLeft} characters remaining
            </span>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim() || overLimit}
              className="btn-primary text-sm px-4 py-1.5"
            >
              {isLoading ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## `components/chat/chat-message.tsx` — Full Implementation

Page citations (`[Page N]`) in AI responses are parsed and rendered as clickable teal chips that fire `onPageCite`.

```typescript
'use client'

interface Props {
  message: {
    id:      string
    role:    'user' | 'assistant'
    content: string
  }
  onPageCite: (page: number) => void
}

export function ChatMessage({ message, onPageCite }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-[#115ACB] text-white'
            : 'bg-[#F4F6F8] text-[#070A0E]'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <AssistantContent content={message.content} onPageCite={onPageCite} />
        )}
      </div>
    </div>
  )
}

function AssistantContent({ content, onPageCite }: { content: string; onPageCite: (page: number) => void }) {
  // Split on [Page N] citations, render chips inline
  const parts = content.split(/(\[Page \d+\])/g)

  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        const match = part.match(/^\[Page (\d+)\]$/)
        if (match) {
          const page = parseInt(match[1], 10)
          return (
            <button
              key={i}
              onClick={() => onPageCite(page)}
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-xs font-medium bg-[#E0F2F1] text-[#00695C] hover:bg-[#B2DFDB] transition-colors"
            >
              Page {page}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}
```

---

## Results Page Integration

In `app/results/[id]/page.tsx` (server component), the `GET /api/contracts/[id]` response already includes `chat_session` and `messages`. Pass them as props to the `ResultsClient`:

```typescript
// Inside ResultsClient (client component):
// <ChatInterface
//   contractId={contract.id}
//   initialSessionId={chatSession?.id ?? null}
//   initialMessages={chatMessages}
//   onPageCite={page => setTargetPage(page)}
// />
```

The `targetPage` state in `ResultsClient` is shared between `PDFViewer`/`TextViewerFallback` and the chat interface, so clicking a `[Page N]` chip in chat scrolls the viewer.

---

## Design Notes

| Element | Style |
|---|---|
| User message bubble | `bg-[#115ACB]` (Blue 500), white text, right-aligned |
| Assistant message bubble | `bg-[#F4F6F8]` (Grey 50), `text-[#070A0E]`, left-aligned |
| Page citation chip | `bg-[#E0F2F1]` teal 50, `text-[#00695C]` teal 700, hover `bg-[#B2DFDB]` |
| Error banner | `bg-[#FAEBEB]` Red 50, `border-[#EAA2A3]` Red 200, text `#581618` Red 900 |
| Loading spinner | `border-[#115ACB]` Blue 500, `border-t-transparent` |
| Empty state text | `text-[#4A4C4F]` Grey 500, centered, top margin |
| Character counter | Grey 500 normally; `text-[#D13438]` Red 500 when over limit |
| Send button | `btn-primary`; disabled when empty, loading, or over limit |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Empty question submitted | Button disabled + `sendMessage()` early-returns |
| Question > 2,000 chars | Client blocks (counter shows red); server returns 400 |
| OpenAI timeout (> 15 s) | `AbortSignal.timeout(15_000)` fires; show "Taking too long" error with Retry |
| Retry button clicked | Calls `sendMessage()` with last user message content |
| Contract not yet `completed` | Server returns 400; chat panel shows error state |
| Chat session already exists | `upsert` with `ON CONFLICT` returns existing row — no duplicate |
| history > 40 messages | `.limit(40)` in DB query keeps context window bounded; all messages still displayed in UI |
| AI response missing [Page N] | Rendered as plain text; no chip emitted — acceptable, not an error |
| Session ID null on first send | `setSessionId(data.session_id)` called after first successful response |
| Network error during send | Error banner shown; optimistic message removed from UI |
| Shift+Enter in textarea | Inserts newline (not send) — standard textarea behaviour |
