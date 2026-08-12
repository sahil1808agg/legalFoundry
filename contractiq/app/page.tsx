import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#070A0E] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 max-w-6xl mx-auto border-b border-white/10">
        <span className="text-xl font-semibold text-white">
          Contract<span className="text-[#89B7FF]">IQ</span>
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="inline-flex items-center px-4 py-2 rounded-md text-[#8F9193] text-sm font-medium hover:text-white hover:bg-white/5 transition-colors duration-100"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center px-4 py-2 rounded-md bg-[#115ACB] text-white text-sm font-medium hover:bg-[#0D469E] transition-colors duration-100"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-20 max-w-4xl mx-auto">
        <span className="inline-block mb-6 px-3 py-1 rounded-full border border-[#115ACB]/40 bg-[#115ACB]/10 text-[#89B7FF] text-xs font-medium">
          NDA &amp; MSA Review · Powered by GPT-4o
        </span>

        <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
          Review any contract{' '}
          <span className="text-[#89B7FF]">in under 15 minutes</span>
        </h1>

        <p className="text-lg text-[#8F9193] max-w-2xl leading-relaxed mb-10">
          ContractIQ automatically extracts key terms from any NDA or MSA, shows exactly where each
          term lives in the document and how confident the AI is — then lets you ask follow-up questions
          in plain English.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/sign-up"
            className="inline-flex items-center px-8 py-3 rounded-md bg-[#115ACB] text-white font-medium hover:bg-[#0D469E] transition-colors duration-100"
          >
            Start Reviewing Contracts Free
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center px-8 py-3 rounded-md border border-white/20 text-white font-medium hover:bg-white/5 transition-colors duration-100"
          >
            Sign in
          </Link>
        </div>

        <p className="mt-4 text-xs text-[#4A4C4F]">
          No credit card required · NDA &amp; MSA supported
        </p>
      </section>

      {/* Feature cards */}
      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          {
            icon: '⚡',
            title: 'Extract key terms instantly',
            body: '10 NDA terms or 12 MSA terms — extracted in under 30 seconds with page attribution and confidence scores.',
          },
          {
            icon: '💬',
            title: 'Chat with your contract',
            body: 'Ask "What happens if I breach this?" in plain English. Every answer is grounded in your document with a page citation.',
          },
          {
            icon: '🎯',
            title: 'Confidence you can trust',
            body: 'Every term shows a confidence score and the exact sentence it came from. Low-confidence terms are flagged automatically.',
          },
        ].map(f => (
          <div key={f.title} className="rounded-lg border border-white/10 bg-white/5 p-6">
            <div className="text-2xl mb-3">{f.icon}</div>
            <h3 className="font-semibold text-white mb-2 text-sm">{f.title}</h3>
            <p className="text-sm text-[#8F9193] leading-relaxed">{f.body}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-8 py-6 text-center text-xs text-[#4A4C4F]">
        ContractIQ is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer.
      </footer>
    </main>
  )
}
