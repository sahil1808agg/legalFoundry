export interface ValidationResult {
  valid: boolean
  error?: string
  wordCount?: number
  tokenCount?: number
}

const MAX_PAGES  = 50
const MIN_WORDS  = 50
const MAX_TOKENS = 80_000

export function validatePDF(text: string, pageCount: number): ValidationResult {
  if (pageCount > MAX_PAGES) {
    return { valid: false, error: `Contract exceeds the maximum of ${MAX_PAGES} pages (found ${pageCount})` }
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount < MIN_WORDS) {
    return { valid: false, error: 'Scanned PDFs are not supported yet. Please upload a text-based PDF.' }
  }

  // Approximate token count: 1 token ≈ 4 characters
  const tokenCount = Math.ceil(text.length / 4)
  if (tokenCount > MAX_TOKENS) {
    return { valid: false, error: `Contract is too long for analysis (max ~${MAX_TOKENS.toLocaleString()} tokens). Please use a shorter document.` }
  }

  return { valid: true, wordCount, tokenCount }
}
