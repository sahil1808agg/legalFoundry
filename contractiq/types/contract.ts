export type ContractType = 'nda' | 'msa'
export type ContractStatus = 'pending' | 'processing' | 'completed' | 'error'

export interface Contract {
  id: string
  user_id: string
  file_name: string
  contract_type: ContractType
  contract_text?: string
  file_path: string | null
  status: ContractStatus
  page_count: number
  token_count: number
  created_at: string
  last_accessed_at?: string
}

export interface KeyTerm {
  id: string
  contract_id: string
  user_id: string
  term_name: string
  value: string
  page_number: number | null
  confidence_score: number
  source_sentence: string
  is_edited: boolean
  original_value: string | null
  is_manual: boolean
  created_at: string
}

export interface CustomKeyTerm {
  id: string
  contract_id: string
  user_id: string
  term_name: string
  created_at: string
}
