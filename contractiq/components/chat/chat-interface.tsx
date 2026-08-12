'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/types/chat'
import { useChat }           from '@/hooks/use-chat'
import { ChatMessageBubble } from './chat-message'

interface ChatInterfaceProps {
  contractId:       string
  initialMessages:  ChatMessage[]
  initialSessionId: string | null
  onPageCite:       (page: number) => void
}

const MAX_CHARS = 2000

export function ChatInterface({
  contractId,
  initialMessages,
  initialSessionId,
  onPageCite,
}: ChatInterfaceProps) {
  const { messages, isLoading, error, sendMessage, clearError } = useChat({
    contractId,
    initialMessages,
    initialSessionId,
  })

  const [input, setInput]       = useState('')
  const messagesEndRef           = useRef<HTMLDivElement>(null)
  const textareaRef              = useRef<HTMLTextAreaElement>(null)
  const charsLeft                = MAX_CHARS - input.length
  const overLimit                = charsLeft < 0

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    if (!input.trim() || isLoading || overLimit) return
    const question = input
    setInput('')
    await sendMessage(question)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-16">
            <div className="w-10 h-10 rounded-full bg-[#E7EFFC] flex items-center justify-center text-[#115ACB] text-lg">
              💬
            </div>
            <p className="text-sm font-medium text-[#070A0E]">Ask anything about this contract</p>
            <p className="text-xs text-[#4A4C4F]">I&apos;ll answer based only on the document text.</p>
          </div>
        ) : (
          messages.map(msg => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              onPageCite={onPageCite}
            />
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-[#115ACB] flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 shrink-0">
              AI
            </div>
            <div className="bg-[#F0F0F1] rounded-xl rounded-bl-sm px-3 py-2">
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-[#4A4C4F] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-[#4A4C4F] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-[#4A4C4F] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 px-3 py-2 bg-[#FAEBEB] border border-[#EAA2A3] rounded-md text-sm text-[#581618]">
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 text-[#581618] hover:text-[#D13438] font-medium text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-[#DADADB] px-4 py-3 bg-white">
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about parties, obligations, dates, payment terms…"
              disabled={isLoading}
              className="input-base resize-none text-sm flex-1"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isLoading || !input.trim() || overLimit}
              className="btn-primary self-end px-3 py-2 text-sm"
              aria-label="Send message"
            >
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M14 8L2 2l2.5 6L2 14l12-6z" fill="currentColor" />
                </svg>
              )}
            </button>
          </div>
          <div className="flex justify-between">
            <p className="text-[10px] text-[#4A4C4F]">Enter to send · Shift+Enter for new line</p>
            <p className={`text-[10px] ${overLimit ? 'text-[#D13438]' : 'text-[#4A4C4F]'}`}>
              {charsLeft} / {MAX_CHARS}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
