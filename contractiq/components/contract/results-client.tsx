'use client'
import { useState, useCallback } from 'react'
import dynamic                   from 'next/dynamic'
import type { ContractApiResponse } from '@/types/api'
import { KeyTermsPanel }   from './key-terms-panel'
import { FeedbackWidget }  from './feedback-widget'
import { ExportButton }    from './export-button'
import { ChatInterface }   from '@/components/chat/chat-interface'
import { TextViewerFallback } from './text-viewer-fallback'

const PDFViewer = dynamic(
  () => import('./pdf-viewer').then(m => ({ default: m.PDFViewer })),
  { ssr: false, loading: () => (
    <div className="h-full flex items-center justify-center bg-[#F0F0F1]">
      <span className="w-6 h-6 border-2 border-[#115ACB] border-t-transparent rounded-full animate-spin" />
    </div>
  )},
)

type Tab = 'terms' | 'chat'

interface ResultsClientProps {
  data: ContractApiResponse
}

export function ResultsClient({ data }: ResultsClientProps) {
  const { contract, key_terms, signed_url, contract_text, chat_session, feedback } = data

  const [targetPage, setTargetPage] = useState(0)
  const [activeTab, setActiveTab]   = useState<Tab>('terms')
  const [editErrorMsg, setEditErrorMsg] = useState<string | null>(null)

  const handlePageClick = useCallback((page: number) => {
    setTargetPage(0)
    requestAnimationFrame(() => setTargetPage(page))
  }, [])

  const handlePageCite = useCallback((page: number) => {
    handlePageClick(page)
  }, [handlePageClick])

  const handleEditError = useCallback((msg: string) => {
    setEditErrorMsg(msg)
    setTimeout(() => setEditErrorMsg(null), 5000)
  }, [])

  const contractLabel = `${contract.contract_type.toUpperCase()} — ${contract.file_name}`

  return (
    <div className="flex flex-col h-screen bg-[#FAFAFA]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#DADADB] shrink-0">
        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-sm text-[#115ACB] hover:underline">
            ← Dashboard
          </a>
          <span className="text-[#DADADB]">|</span>
          <h1 className="text-sm font-semibold text-[#070A0E] truncate max-w-[320px]" title={contract.file_name}>
            {contractLabel}
          </h1>
          {contract.status === 'completed' && (
            <span className="badge-green text-xs">Completed</span>
          )}
        </div>
        <ExportButton
          terms={key_terms}
          contractName={contract.file_name}
          disabled={key_terms.length === 0}
        />
      </header>

      {/* Edit error toast */}
      {editErrorMsg && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 bg-[#FAEBEB] border border-[#EAA2A3] rounded-lg text-sm text-[#581618] shadow-lg max-w-sm">
          {editErrorMsg}
        </div>
      )}

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — document viewer (55%) */}
        <div className="w-[55%] border-r border-[#DADADB] overflow-hidden">
          {signed_url ? (
            <PDFViewer signedUrl={signed_url} targetPage={targetPage} />
          ) : (
            <TextViewerFallback contractText={contract_text} targetPage={targetPage} />
          )}
        </div>

        {/* Right panel — tabs (45%) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[#DADADB] bg-white shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('terms')}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors duration-100 ${
                activeTab === 'terms'
                  ? 'border-[#115ACB] text-[#115ACB]'
                  : 'border-transparent text-[#4A4C4F] hover:text-[#070A0E]'
              }`}
            >
              Key Terms
              {key_terms.length > 0 && (
                <span className="ml-1.5 text-xs bg-[#F0F0F1] text-[#4A4C4F] px-1.5 py-0.5 rounded-full">
                  {key_terms.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors duration-100 ${
                activeTab === 'chat'
                  ? 'border-[#115ACB] text-[#115ACB]'
                  : 'border-transparent text-[#4A4C4F] hover:text-[#070A0E]'
              }`}
            >
              Chat
              {chat_session.messages.length > 0 && (
                <span className="ml-1.5 text-xs bg-[#E7EFFC] text-[#115ACB] px-1.5 py-0.5 rounded-full">
                  {chat_session.messages.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'terms' ? (
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <KeyTermsPanel
                  initialTerms={key_terms}
                  onPageClick={handlePageClick}
                  onEditError={handleEditError}
                />
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <ChatInterface
                  contractId={contract.id}
                  initialMessages={chat_session.messages}
                  initialSessionId={chat_session.session_id}
                  onPageCite={handlePageCite}
                />
              </div>
            )}
          </div>

          {/* Feedback + disclaimer footer */}
          <div className="border-t border-[#DADADB] bg-white px-4 py-4 shrink-0">
            <FeedbackWidget
              contractId={contract.id}
              initialRating={feedback?.rating ?? null}
              initialComment={feedback?.comment ?? null}
            />
            <p className="mt-3 text-[10px] text-[#8F9193] leading-relaxed">
              ContractIQ uses AI to extract and summarise contract terms. This is not legal advice.
              Always verify key terms with a qualified legal professional before acting on this review.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
