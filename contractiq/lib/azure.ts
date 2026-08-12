import OpenAI from 'openai'

// Strip the trailing /responses that the portal copies — the SDK appends it automatically
const raw = process.env.AZURE_AGENT_ENDPOINT!
const baseURL = raw.endsWith('/responses') ? raw.slice(0, -'/responses'.length) : raw

export const azureClient = new OpenAI({
  apiKey: process.env.AZURE_API_KEY!,
  baseURL,
  defaultQuery: { 'api-version': '2025-05-15-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_API_KEY! },
})
