export type MessageRole  = 'user' | 'assistant'
export type ContextType  = 'contract' | 'history' | 'both'

export interface ChatSession {
  id: string
  contract_id: string
  user_id: string
  created_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  user_id: string
  role: MessageRole
  content: string
  context_type: ContextType | null  // null for user messages and historical messages pre-feature
  created_at: string
}
