import OpenAI from 'openai'

// Server-side only — OPENAI_API_KEY is never exposed to the client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})
