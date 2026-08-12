const ENDPOINT = process.env.AZURE_AGENT_ENDPOINT!
const API_KEY  = process.env.AZURE_API_KEY!
const API_VER  = '2025-05-15-preview'

interface AzureOutputItem {
  type: string
  role?: string
  content?: { type: string; text?: string }[]
}

export async function callAzureAgent(input: string): Promise<string> {
  const url = `${ENDPOINT}?api-version=${API_VER}`

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key':      API_KEY,
    },
    body: JSON.stringify({ input }),
  })

  const data = await res.json()

  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`
    throw new Error(msg)
  }

  // Find the assistant message item in the output array
  const output: AzureOutputItem[] = data.output ?? []
  for (const item of output) {
    if (item.type === 'message' && item.role === 'assistant') {
      const text = item.content?.find(c => c.type === 'output_text')?.text
      if (text) return text
    }
  }

  return 'No response generated.'
}
