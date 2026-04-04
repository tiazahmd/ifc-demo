import type { ProgressEvent } from '../types.js'

const BASE = 'https://public-api.gamma.app/v1.0'
const HEADERS = {
  'X-API-KEY': process.env.GAMMA_API_KEY ?? '',
  'Content-Type': 'application/json',
}

export async function generateDeck(
  slideInstructions: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<string> {
  await emit({ type: 'status', step: 'generating_deck', detail: 'Gamma — Generation submitted. Polling...' })

  const res = await fetch(`${BASE}/generations`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      inputText: slideInstructions,
      textMode: 'preserve',
      format: 'presentation',
      numCards: 12,
      exportAs: 'pptx',
      theme: process.env.GAMMA_THEME_ID,
    }),
  })
  if (!res.ok) throw new Error(`Gamma submit failed: ${res.status}`)
  const { generationId } = await res.json() as { generationId: string }

  // Poll for completion + exportUrl
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5_000))
    const poll = await fetch(`${BASE}/generations/${generationId}`, { headers: HEADERS })
    if (!poll.ok) throw new Error(`Gamma poll failed: ${poll.status}`)
    const data = await poll.json() as { status: string; exportUrl?: string }

    if (data.status === 'completed' && data.exportUrl) {
      await emit({ type: 'status', step: 'generating_deck', detail: 'Gamma — COMPLETED. Export ready.' })
      return data.exportUrl
    }
    if (data.status === 'failed') throw new Error('Gamma generation failed')
  }

  throw new Error('Gamma generation timed out')
}
