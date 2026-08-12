import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contractId = params.id

  // Fetch contract
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, file_name, contract_type, status, page_count, contract_text, file_path, created_at, last_accessed_at')
    .eq('id', contractId)
    .eq('user_id', user.id)
    .single()

  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  // Fetch key terms
  const { data: keyTerms } = await supabase
    .from('key_terms')
    .select('id, term_name, value, page_number, confidence_score, source_sentence, is_edited, original_value, is_manual, created_at')
    .eq('contract_id', contractId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  // Generate signed URL (1-hour expiry)
  let signedUrl: string | null = null
  if (contract.file_path) {
    const { data: signedData } = await supabase.storage
      .from('contracts')
      .createSignedUrl(contract.file_path, 3600)
    signedUrl = signedData?.signedUrl ?? null
  }

  // Fetch chat session + initial messages
  const { data: chatSession } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('contract_id', contractId)
    .eq('user_id', user.id)
    .single()

  let chatMessages: unknown[] = []
  if (chatSession) {
    const { data: messages } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', chatSession.id)
      .order('created_at', { ascending: true })
      .limit(100)
    chatMessages = messages ?? []
  }

  // Fetch existing feedback
  const { data: feedback } = await supabase
    .from('user_feedback')
    .select('rating, comment')
    .eq('contract_id', contractId)
    .eq('user_id', user.id)
    .single()

  // Update last_accessed_at (non-blocking)
  supabase
    .from('contracts')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', contractId)
    .then(() => {})

  return NextResponse.json({
    contract: {
      id:               contract.id,
      file_name:        contract.file_name,
      contract_type:    contract.contract_type,
      status:           contract.status,
      page_count:       contract.page_count,
      created_at:       contract.created_at,
    },
    key_terms:     keyTerms ?? [],
    signed_url:    signedUrl,
    contract_text: contract.contract_text,
    chat_session: {
      session_id: chatSession?.id ?? null,
      messages:   chatMessages,
    },
    feedback: feedback ?? null,
  })
}
