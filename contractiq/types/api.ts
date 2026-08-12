import type { Contract, KeyTerm } from './contract'
import type { ChatMessage } from './chat'

export interface UploadApiResponse {
  contract_id: string
  page_count: number
  token_count: number
}

export interface ProcessApiResponse {
  contract_id: string
  terms_extracted: number
  status: 'completed'
}

export interface ContractApiResponse {
  contract: Contract
  key_terms: KeyTerm[]
  signed_url: string | null
  contract_text: string
  chat_session: {
    session_id: string | null
    messages: ChatMessage[]
  }
  feedback: { rating: 'up' | 'down'; comment: string | null } | null
}

export interface PatchTermApiResponse {
  id: string
  value: string
  is_edited: true
  original_value: string
}

export interface ChatApiResponse {
  session_id: string
  message: ChatMessage
}

export interface DashboardApiResponse {
  contracts: Pick<Contract, 'id' | 'file_name' | 'contract_type' | 'status' | 'page_count' | 'created_at'>[]
  total: number
  nda_count: number
  msa_count: number
  page: number
  limit: number
}

export interface FeedbackApiResponse {
  id: string
  rating: 'up' | 'down'
  created_at: string
}
