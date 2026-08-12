import { z }            from 'zod'
import { NextResponse } from 'next/server'

// ─── File upload constraints ──────────────────────────────────────────────────
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.js', '.mjs', '.cjs', '.php', '.zip',
  '.sh', '.bat', '.cmd', '.py', '.rb', '.ps1',
])
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx'])
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const uploadBodySchema = z.object({
  contract_type: z.enum(['nda', 'msa'], {
    errorMap: () => ({ message: 'contract_type must be "nda" or "msa"' }),
  }),
  custom_terms: z
    .array(z.string().min(1).max(100))
    .max(5, 'Maximum 5 custom terms allowed')
    .optional()
    .default([]),
})

export const processBodySchema = z.object({
  contract_id: z.string().uuid('contract_id must be a valid UUID'),
})

export const chatBodySchema = z.object({
  contract_id: z.string().uuid('contract_id must be a valid UUID'),
  question:    z
    .string()
    .min(1, 'question is required')
    .max(5000, 'Question exceeds 5,000 characters'),
})

export const termPatchSchema = z.object({
  value: z
    .string()
    .min(1, 'value cannot be empty')
    .max(5000, 'Value exceeds 5,000 characters'),
})

export const feedbackBodySchema = z.object({
  contract_id: z.string().uuid('contract_id must be a valid UUID'),
  rating:      z.enum(['up', 'down'], {
    errorMap: () => ({ message: 'rating must be "up" or "down"' }),
  }),
  comment: z
    .string()
    .max(1000, 'Comment must be 1,000 characters or fewer')
    .nullable()
    .optional(),
})

export const dashboardQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(50).default(20),
  sort_by:  z
    .enum(['created_at', 'file_name', 'contract_type', 'status', 'page_count'])
    .default('created_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ParseOk<T>   = { success: true; data: T }
type ParseFail    = { success: false; error: NextResponse }

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): ParseOk<z.output<S>> | ParseFail {
  const result = schema.safeParse(data)
  if (!result.success) {
    const message = result.error.errors.map(e => e.message).join('; ')
    return {
      success: false,
      error:   NextResponse.json({ error: message }, { status: 422 }),
    }
  }
  return { success: true, data: result.data as z.output<S> }
}

// ─── File upload validation ───────────────────────────────────────────────────

type FileValidOk   = { valid: true }
type FileValidFail = { valid: false; error: NextResponse }

export function validateFileUpload(file: File): FileValidOk | FileValidFail {
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`

  // 1. Block dangerous extensions
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: NextResponse.json(
        { error: `File type ${ext} is not allowed` },
        { status: 400 }
      ),
    }
  }

  // 2. Enforce allow-list
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: NextResponse.json(
        { error: 'Only PDF files are accepted' },
        { status: 400 }
      ),
    }
  }

  // 3. Validate MIME type (defence against renamed files)
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: NextResponse.json(
        { error: 'File MIME type does not match the expected format' },
        { status: 400 }
      ),
    }
  }

  // 4. Enforce size limit
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: NextResponse.json(
        { error: 'File exceeds the 10 MB limit' },
        { status: 400 }
      ),
    }
  }

  return { valid: true }
}
