'use client'
import { useState, useCallback, useRef } from 'react'
import type { ChatMessage } from '@/types/chat'

interface UseChatOptions {
  contractId:      string
  initialMessages: ChatMessage[]
  initialSessionId: string | null
}

export function useChat({ contractId, initialMessages, initialSessionId }: UseChatOptions) {
  const [messages, setMessages]   = useState<ChatMessage[]>(initialMessages)
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const abortRef                  = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || isLoading) return

    setError(null)
    setIsLoading(true)

    // Optimistic user message (no id yet)
    const optimisticUser: ChatMessage = {
      id:           `optimistic-${Date.now()}`,
      session_id:   sessionId ?? '',
      user_id:      '',
      role:         'user',
      content:      trimmed,
      context_type: null,
      created_at:   new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimisticUser])

    abortRef.current = new AbortController()
    const timeoutId  = setTimeout(() => abortRef.current?.abort(), 15_000)

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contract_id: contractId, question: trimmed }),
        signal:  abortRef.current.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to get a response')
      }

      const data: { session_id: string; message: ChatMessage } = await res.json()

      if (!sessionId) setSessionId(data.session_id)

      // Replace optimistic message with confirmed user message, then append assistant reply
      setMessages(prev => [
        ...prev.filter(m => m.id !== optimisticUser.id),
        { ...optimisticUser, id: `user-${Date.now()}`, session_id: data.session_id },
        ...(data.message ? [data.message] : []),
      ])
    } catch (err) {
      clearTimeout(timeoutId)
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticUser.id))
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timed out — please try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
    }
  }, [contractId, sessionId, isLoading])

  const clearError = useCallback(() => setError(null), [])

  return { messages, sessionId, isLoading, error, sendMessage, clearError }
}
