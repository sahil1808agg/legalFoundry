import type { ContractType } from '@/types/contract'

const NDA_TERMS = [
  'Parties', 'Effective Date', 'Confidentiality Obligations', 'Permitted Disclosures',
  'Term & Duration', 'Governing Law', 'Jurisdiction', 'IP Ownership',
  'Non-Solicitation', 'Breach & Remedy',
]

const MSA_TERMS = [
  'Parties', 'Service Scope', 'Payment Terms', 'Invoice Schedule',
  'Late Payment Penalty', 'Liability Cap', 'Indemnification', 'IP Ownership',
  'Termination Clause', 'Governing Law', 'Dispute Resolution', 'Notice Period',
]

interface Props {
  value:    ContractType | null
  onChange: (type: ContractType) => void
}

export function ContractTypeSelect({ value, onChange }: Props) {
  const terms = value === 'nda' ? NDA_TERMS : value === 'msa' ? MSA_TERMS : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[#070A0E]">Contract type</label>
        <div className="flex gap-3">
          {(['nda', 'msa'] as ContractType[]).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => onChange(type)}
              className={`flex-1 py-2.5 rounded-md border text-sm font-medium transition-colors duration-100 ${
                value === type
                  ? 'bg-[#E7EFFC] border-[#115ACB] text-[#115ACB]'
                  : 'bg-white border-[#DADADB] text-[#4A4C4F] hover:border-[#8F9193]'
              }`}
            >
              {type.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {value && (
        <div className="rounded-md border border-[#F0F0F1] bg-[#FAFAFA] p-4">
          <p className="text-xs font-medium text-[#4A4C4F] mb-2">
            Terms to be extracted ({terms.length}):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {terms.map(term => (
              <span key={term} className="badge-grey text-xs">
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
