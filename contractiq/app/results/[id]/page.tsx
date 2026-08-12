import { redirect, notFound } from 'next/navigation'
import { createClient }       from '@/lib/supabase/server'
import { ResultsClient }      from '@/components/contract/results-client'
import type { ContractApiResponse } from '@/types/api'

interface ResultsPageProps {
  params: { id: string }
}

export default async function ResultsPage({ params }: ResultsPageProps) {
  const supabase = createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/sign-in')

  // Fetch contract, key terms, and feedback in parallel
  const [contractRes, termsRes, feedbackRes] = await Promise.all([
    supabase
      .from('contracts')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('key_terms')
      .select('*')
      .eq('contract_id', params.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('user_feedback')
      .select('rating, comment')
      .eq('contract_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (contractRes.error || !contractRes.data) notFound()

  const contract  = contractRes.data
  const key_terms = termsRes.data ?? []

  // Fetch chat session then messages
  const { data: sessionRow } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('contract_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  const messages = sessionRow
    ? (await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionRow.id)
        .order('created_at', { ascending: true })
        .limit(200)
      ).data ?? []
    : []

  // Generate signed URL for PDF viewer (null if no file_path)
  let signed_url: string | null = null
  if (contract.file_path) {
    const { data: signedData } = await supabase.storage
      .from('contracts')
      .createSignedUrl(contract.file_path, 3600)
    signed_url = signedData?.signedUrl ?? null
  }

  // Non-blocking last_accessed_at update
  void Promise.resolve(
    supabase
      .from('contracts')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('id', params.id)
  ).catch(() => {})

  const data: ContractApiResponse = {
    contract,
    key_terms,
    signed_url,
    contract_text: contract.contract_text ?? '',
    chat_session: {
      session_id: sessionRow?.id ?? null,
      messages,
    },
    feedback: feedbackRes.data ?? null,
  }

  return <ResultsClient data={data} />
}
