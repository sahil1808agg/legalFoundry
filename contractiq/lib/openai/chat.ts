import { openai }       from './client'
import type { ContextType } from '@/types/chat'

// ─── System prompts ───────────────────────────────────────────────────────────

const CONTRACT_PROMPT = `You are ContractIQ, an AI contract review assistant.

Rules:
1. Answer ONLY from the contract text provided below. Never invent clauses or use outside knowledge.
2. Every response MUST include at least one page citation in the format [Page X].
3. Begin every response with "Based on the document..."
4. If the answer is not in the contract, respond: "I couldn't find that in this contract."
5. Be concise and precise. Use plain English — avoid legal jargon.
6. If legal advice is requested, clarify that you provide information only, not legal advice.
7. For multi-part answers, use short bullet points.`

const HISTORY_PROMPT = `You are ContractIQ, an AI contract review assistant.

The user is asking about your previous conversation — not the contract document itself.

Rules:
1. Answer ONLY from the conversation history provided. Do not reference the contract text.
2. End every response with [From conversation].
3. If the answer is not in the conversation history, respond: "I don't see that in our conversation."
4. Be concise and direct.`

const BOTH_PROMPT = `You are ContractIQ, an AI contract review assistant.

The user is asking about both the contract document and your previous conversation.

Rules:
1. When citing a fact from the contract, include a page citation: [Page X].
2. When citing a fact from the conversation, append: [From conversation].
3. Begin every response with "Based on the document and our discussion..."
4. If something cannot be found in either source, say so clearly.
5. Be concise. Use plain English.`

// ─── Classifier ───────────────────────────────────────────────────────────────

export type QueryType = ContextType  // 'contract' | 'history' | 'both'

// History-referencing phrases the user might say
const HISTORY_SIGNALS = [
  'you said', 'you mentioned', 'you told me', 'you noted', 'you explained',
  'earlier you', 'earlier i', 'you previously', 'previously you',
  'what did you say', 'what did i ask', 'what did you tell',
  'last message', 'last response', 'last answer', 'last time',
  'we discussed', 'we talked about', 'we went over', 'our conversation',
  'in this chat', 'in this session', 'i asked you', 'i asked about',
  'you answered', 'you replied', 'your previous', 'your last',
  'remind me', 'what was', 'what were',
]

// Contract-referencing phrases that override a history signal
const CONTRACT_SIGNALS = [
  'contract', 'agreement', 'clause', 'section', 'provision', 'nda', 'msa',
  'document', 'terms', 'parties', 'governing law', 'jurisdiction',
  'termination', 'liability', 'indemnif', 'confidential', 'payment',
  'effective date', 'notice', 'ip ownership', 'intellectual property',
]

export function classifyQuery(question: string): QueryType {
  const q = question.toLowerCase()
  const hasHistorySignal  = HISTORY_SIGNALS.some(k => q.includes(k))
  const hasContractSignal = CONTRACT_SIGNALS.some(k => q.includes(k))

  if (hasHistorySignal && hasContractSignal) return 'both'
  if (hasHistorySignal)                      return 'history'
  return 'contract'
}

// ─── Context windowing ────────────────────────────────────────────────────────

// Returns the last N complete turns (user + assistant pairs) from history.
function lastTurns(
  history: { role: 'user' | 'assistant'; content: string }[],
  turns: number,
): { role: 'user' | 'assistant'; content: string }[] {
  const maxMessages = turns * 2
  return history.slice(-maxMessages)
}

// ─── Response builder ─────────────────────────────────────────────────────────

export async function buildChatResponse(
  contractText: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  queryType: QueryType,
): Promise<string> {
  let systemContent: string
  let contextHistory: { role: 'user' | 'assistant'; content: string }[]

  switch (queryType) {
    case 'history':
      // No contract text; up to 20 turns of conversation
      systemContent  = HISTORY_PROMPT
      contextHistory = lastTurns(history, 20)
      break

    case 'both':
      // Contract text + last 10 turns
      systemContent  = `${BOTH_PROMPT}\n\nCONTRACT TEXT:\n${contractText}`
      contextHistory = lastTurns(history, 10)
      break

    case 'contract':
    default:
      // Contract text + last 10 turns (gives the model conversational continuity)
      systemContent  = `${CONTRACT_PROMPT}\n\nCONTRACT TEXT:\n${contractText}`
      contextHistory = lastTurns(history, 10)
      break
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemContent },
    ...contextHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
