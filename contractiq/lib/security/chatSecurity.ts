import { NextResponse }  from 'next/server'
import { createClient } from '@/lib/supabase/server'

type OwnershipOk   = { ok: true }
type OwnershipFail = { ok: false; response: NextResponse }

/**
 * Verifies that the given contract exists, is owned by userId,
 * and has status 'completed' (required for chat).
 * Returns the contract's contract_text on success.
 */
export async function verifyContractOwnership(
  contractId: string,
  userId: string,
): Promise<{ ok: true; contractText: string } | OwnershipFail> {
  const supabase = createClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, contract_text, status, user_id')
    .eq('id', contractId)
    .eq('user_id', userId)
    .single()

  if (!contract) {
    return {
      ok:       false,
      response: NextResponse.json({ error: 'Contract not found' }, { status: 404 }),
    }
  }

  if (contract.status !== 'completed') {
    return {
      ok:       false,
      response: NextResponse.json(
        { error: 'Contract has not been processed yet' },
        { status: 400 }
      ),
    }
  }

  return { ok: true, contractText: contract.contract_text as string }
}

/**
 * Verifies that the given chat session exists and is owned by userId.
 */
export async function verifySessionOwnership(
  sessionId: string,
  userId: string,
): Promise<OwnershipOk | OwnershipFail> {
  const supabase = createClient()

  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()

  if (!session) {
    return {
      ok:       false,
      response: NextResponse.json({ error: 'Session not found' }, { status: 404 }),
    }
  }

  return { ok: true }
}
