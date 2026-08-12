import Link from 'next/link'
import { SignUpForm } from '@/components/auth/sign-up-form'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="mb-6">
          <Link href="/" className="text-lg font-semibold text-[#070A0E]">
            Contract<span className="text-[#115ACB]">IQ</span>
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-[#070A0E] mb-1">Create your account</h1>
        <p className="text-sm text-[#4A4C4F] mb-6">Start reviewing contracts for free</p>
        <SignUpForm />
        <p className="text-xs text-[#4A4C4F] text-center mt-6">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-[#115ACB] hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
