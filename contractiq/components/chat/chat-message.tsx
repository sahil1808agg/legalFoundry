'use client'
import type { ChatMessage, ContextType } from '@/types/chat'

interface ChatMessageProps {
  message:    ChatMessage
  onPageCite: (page: number) => void
}

const SOURCE_LABELS: Record<ContextType, { label: string; className: string }> = {
  contract: {
    label:     'From contract',
    className: 'bg-[#E7EFFC] text-[#115ACB] border-[#B3C9EE]',
  },
  history: {
    label:     'From conversation',
    className: 'bg-[#F0F0F1] text-[#4A4C4F] border-[#DADADB]',
  },
  both: {
    label:     'Contract + conversation',
    className: 'bg-[#F7F0FF] text-[#380070] border-[#E3C7FF]',
  },
}

function renderContent(content: string, onPageCite: (page: number) => void) {
  // Render [Page N] as clickable chips and [From conversation] as a styled tag
  const parts = content.split(/(\[Page\s+\d+\]|\[PAGE\s+\d+\]|\[From conversation\])/gi)

  return parts.map((part, i) => {
    const pageMatch = part.match(/\[Page\s+(\d+)\]/i)
    if (pageMatch) {
      const page = parseInt(pageMatch[1], 10)
      return (
        <button
          key={i}
          type="button"
          onClick={() => onPageCite(page)}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#E7EFFC] text-[#115ACB] border border-[#B3C9EE] hover:bg-[#B3C9EE] transition-colors duration-100 mx-0.5"
        >
          Page {page}
        </button>
      )
    }
    if (/\[From conversation\]/i.test(part)) {
      return (
        <span
          key={i}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#F0F0F1] text-[#4A4C4F] border border-[#DADADB] mx-0.5"
        >
          From conversation
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function ChatMessageBubble({ message, onPageCite }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const source = !isUser && message.context_type ? SOURCE_LABELS[message.context_type] : null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-[#115ACB] flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 shrink-0">
          AI
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-[80%]">
        <div
          className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#115ACB] text-white rounded-br-sm'
              : 'bg-[#F0F0F1] text-[#070A0E] rounded-bl-sm'
          }`}
        >
          {renderContent(message.content, onPageCite)}
          <p className={`text-[10px] mt-1 ${isUser ? 'text-[#B3C9EE]' : 'text-[#8F9193]'}`}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Source attribution badge — shown only on assistant messages */}
        {source && (
          <span
            className={`self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${source.className}`}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
              <circle cx="4" cy="4" r="3.5" stroke="currentColor" strokeWidth="1" />
              <path d="M4 2.5v2l1 1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
            </svg>
            {source.label}
          </span>
        )}
      </div>
    </div>
  )
}
