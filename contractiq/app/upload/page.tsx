'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ContractUploader }   from '@/components/contract/contract-uploader'
import { ContractTypeSelect } from '@/components/contract/contract-type-select'
import { CustomTermAdder }    from '@/components/contract/custom-term-adder'
import { ProcessButton }      from '@/components/contract/process-button'
import { SignOutButton }       from '@/components/auth/sign-out-button'
import type { ContractType }   from '@/types/contract'

export default function UploadPage() {
  const [file, setFile]                 = useState<File | null>(null)
  const [contractType, setContractType] = useState<ContractType | null>(null)
  const [customTerms, setCustomTerms]   = useState<string[]>([])

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <header className="bg-white border-b border-[#F0F0F1]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-lg font-semibold text-[#070A0E]">
            Contract<span className="text-[#115ACB]">IQ</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-[#4A4C4F] hover:text-[#070A0E]">
              Dashboard
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#070A0E] mb-1">Review a Contract</h1>
          <p className="text-sm text-[#4A4C4F]">
            Upload an NDA or MSA (PDF · max 10 MB · max 20 pages) to extract key terms automatically.
          </p>
        </div>

        <div className="card p-6 flex flex-col gap-6">
          <ContractTypeSelect value={contractType} onChange={setContractType} />

          <div className="divider" />

          <ContractUploader file={file} onChange={setFile} />

          <div className="divider" />

          <CustomTermAdder terms={customTerms} onChange={setCustomTerms} />

          <div className="divider" />

          <ProcessButton
            file={file}
            contractType={contractType}
            customTerms={customTerms}
          />
        </div>

        <p className="mt-6 text-xs text-[#4A4C4F] text-center">
          ContractIQ is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer.
        </p>
      </main>
    </div>
  )
}
