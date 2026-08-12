'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ContractType } from '@/types/contract'

type Step = 'idle' | 'uploading' | 'analysing' | 'done' | 'error'

const STEP_LABELS: Record<Step, string> = {
  idle:      'Process Contract',
  uploading: 'Step 1/3 — Extracting text…',
  analysing: 'Step 2/3 — Analysing with AI…',
  done:      'Step 3/3 — Compiling results…',
  error:     'Processing failed',
}

interface Props {
  file:         File | null
  contractType: ContractType | null
  customTerms:  string[]
}

export function ProcessButton({ file, contractType, customTerms }: Props) {
  const router  = useRouter()
  const [step, setStep]   = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)

  const disabled = !file || !contractType || step !== 'idle'

  async function handleProcess() {
    if (!file || !contractType) return
    setStep('uploading')
    setError(null)

    try {
      // Step 1: Upload
      const formData = new FormData()
      formData.append('file', file)
      formData.append('contract_type', contractType)
      if (customTerms.length > 0) {
        formData.append('custom_terms', JSON.stringify(customTerms))
      }

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body:   formData,
      })

      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}))
        throw new Error(data.error ?? 'Upload failed')
      }

      const { contract_id } = await uploadRes.json()

      // Step 2: Process (AI extraction)
      setStep('analysing')

      const processRes = await fetch('/api/process', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contract_id }),
      })

      if (!processRes.ok) {
        const data = await processRes.json().catch(() => ({}))
        throw new Error(data.error ?? 'AI processing failed')
      }

      // Step 3: Navigate
      setStep('done')
      router.push(`/results/${contract_id}`)
    } catch (err) {
      setStep('error')
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    }
  }

  function handleRetry() {
    setStep('idle')
    setError(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {step !== 'idle' && step !== 'error' && (
        <div className="rounded-md border border-[#DADADB] bg-white p-4">
          <div className="flex items-center gap-3">
            <span className="inline-block w-4 h-4 border-2 border-[#115ACB] border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-sm text-[#4A4C4F]">{STEP_LABELS[step]}</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-[#F0F0F1] overflow-hidden">
            <div
              className="h-full bg-[#115ACB] rounded-full transition-all duration-700"
              style={{
                width: step === 'uploading' ? '33%' : step === 'analysing' ? '66%' : '100%',
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-[#EAA2A3] bg-[#FAEBEB] px-4 py-3">
          <p className="text-sm text-[#581618] mb-2">{error}</p>
          <button onClick={handleRetry} className="text-xs font-medium text-[#D13438] hover:underline">
            Try again
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={step === 'error' ? handleRetry : handleProcess}
        disabled={disabled}
        className="btn-primary w-full py-3"
      >
        {step === 'idle'  && 'Process Contract'}
        {step === 'error' && 'Retry'}
        {(step === 'uploading' || step === 'analysing' || step === 'done') && STEP_LABELS[step]}
      </button>

      {!file && (
        <p className="text-xs text-[#4A4C4F] text-center">
          Select a PDF and choose a contract type to continue.
        </p>
      )}
    </div>
  )
}
