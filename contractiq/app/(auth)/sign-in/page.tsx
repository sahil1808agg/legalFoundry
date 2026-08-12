import Link from 'next/link'
import { SignInForm } from '@/components/auth/sign-in-form'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="mb-6">
          <Link href="/" className="text-lg font-semibold text-[#070A0E]">
            Contract<span className="text-[#115ACB]">IQ</span>
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-[#070A0E] mb-1">Sign in</h1>
        <p className="text-sm text-[#4A4C4F] mb-6">Welcome back to ContractIQ</p>
        <SignInForm />
        <p className="text-xs text-[#4A4C4F] text-center mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="text-[#115ACB] hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
