import Link from 'next/link'
import type { ContractRow, SortColumn, SortDir } from '@/hooks/use-dashboard'

const STATUS_STYLES: Record<string, string> = {
  completed:  'badge-green',
  processing: 'badge-amber',
  pending:    'badge-grey',
  error:      'badge-red',
}

const STATUS_LABELS: Record<string, string> = {
  completed:  'Completed',
  processing: 'Processing',
  pending:    'Pending',
  error:      'Failed',
}

interface Props {
  contracts: ContractRow[]
  sortBy:    SortColumn
  sortDir:   SortDir
  onSort:    (col: SortColumn) => void
}

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'file_name',     label: 'File Name' },
  { key: 'contract_type', label: 'Type'      },
  { key: 'status',        label: 'Status'    },
  { key: 'page_count',    label: 'Pages'     },
  { key: 'created_at',    label: 'Uploaded'  },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function truncate(name: string, max = 40) {
  return name.length > max ? name.slice(0, max) + '…' : name
}

export function DashboardTable({ contracts, sortBy, sortDir, onSort }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#F0F0F1]">
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="text-left py-3 px-4 font-medium text-[#4A4C4F] cursor-pointer hover:text-[#070A0E] select-none whitespace-nowrap"
              >
                {col.label}{' '}
                {sortBy === col.key ? (
                  <span className="text-[#115ACB]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                ) : (
                  <span className="text-[#C1C2C3]">↕</span>
                )}
              </th>
            ))}
            <th className="py-3 px-4 w-16" />
          </tr>
        </thead>
        <tbody>
          {contracts.map(contract => (
            <tr
              key={contract.id}
              className="border-b border-[#F0F0F1] hover:bg-[#FAFAFA] transition-colors duration-75"
            >
              <td className="py-3 px-4 font-medium text-[#070A0E] max-w-[200px]">
                <Link href={`/results/${contract.id}`} className="block" title={contract.file_name}>
                  {truncate(contract.file_name)}
                </Link>
              </td>
              <td className="py-3 px-4">
                <span className="uppercase text-xs font-semibold text-[#4A4C4F]">
                  {contract.contract_type}
                </span>
              </td>
              <td className="py-3 px-4">
                <span className={STATUS_STYLES[contract.status] ?? 'badge-grey'}>
                  {STATUS_LABELS[contract.status] ?? contract.status}
                </span>
              </td>
              <td className="py-3 px-4 text-[#4A4C4F]">{contract.page_count}</td>
              <td className="py-3 px-4 text-[#4A4C4F] whitespace-nowrap">{formatDate(contract.created_at)}</td>
              <td className="py-3 px-4 text-right">
                {contract.status === 'error' ? (
                  <Link
                    href={`/upload?retry=${contract.id}`}
                    className="text-xs font-medium text-[#D13438] hover:underline"
                  >
                    Retry
                  </Link>
                ) : (
                  <Link
                    href={`/results/${contract.id}`}
                    className="text-xs font-medium text-[#115ACB] hover:underline"
                  >
                    View
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
