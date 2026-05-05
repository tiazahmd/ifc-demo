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
  // Post-process: Claude often uses --- as decorative separators within slides despite instructions not to.
  // True slide breaks are \n---\n followed by a heading (# ...) or end of content.
  // Strategy: Remove ALL --- lines, then re-insert them only before lines starting with # (markdown headings that begin new slides).
  let processed = slideInstructions
  const rawBreaks = (processed.match(/\n---\n/g) || []).length

  if (rawBreaks > 20) {
    // Too many breaks — Claude used --- decoratively. Strip all and re-insert at slide boundaries.
    // Split on --- to get chunks, then identify slide boundaries by looking for top-level headings
    const lines = processed.split('\n')
    const cleanedLines: string[] = []
    for (const line of lines) {
      if (line.trim() === '---') continue // skip all --- lines
      cleanedLines.push(line)
    }

    // Re-insert --- before each top-level heading (# ) that starts a new slide
    // Skip the very first heading (no break before the first slide)
    const result: string[] = []
    let foundFirstHeading = false
    for (const line of cleanedLines) {
      if (/^# /.test(line) && foundFirstHeading) {
        result.push('---')
        result.push('')
      }
      if (/^# /.test(line)) foundFirstHeading = true
      result.push(line)
    }

    processed = result.join('\n')
    const newBreaks = (processed.match(/\n---\n/g) || []).length
    await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Post-processed: ${rawBreaks} raw breaks → ${newBreaks} slide breaks (stripped decorative separators)` })
  }

  // Log input size for debugging
  await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Preparing submission. Input size: ${processed.length} chars. Card breaks: ${(processed.match(/\n---\n/g) || []).length}` })

  const body = {
    inputText: processed,
    textMode: 'preserve',
    cardSplit: 'inputTextBreaks',
    format: 'presentation',
    exportAs: 'pptx',
    themeId: process.env.GAMMA_THEME_ID || undefined,
    cardOptions: {
      dimensions: '16x9',
    },
    imageOptions: {
      source: 'themeAccent',
    },
    additionalInstructions: 'This is a formal IFC (International Finance Corporation) advisory pitch deck. Use clean, professional, corporate layouts. Prefer structured text layouts with clear hierarchy. For slides with tables, use clean grid formatting. For the tombstone/track record slide, arrange items in a card grid. Keep the aesthetic institutional and understated — no playful or casual elements. Use the theme colors consistently.',
  }

  // Log config (without full inputText)
  await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Config: textMode=${body.textMode}, cardSplit=${body.cardSplit}, format=${body.format}, dimensions=${body.cardOptions.dimensions}, imageSource=${body.imageOptions.source}, themeId=${body.themeId ?? 'NONE (will use workspace default)'}` })

  if (!process.env.GAMMA_API_KEY) {
    throw new Error('Gamma API key not configured. Set GAMMA_API_KEY environment variable on Render.')
  }

  let res: Response
  try {
    res = await fetch(`${BASE}/generations`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Gamma network error (could not reach API): ${msg}`)
  }

  if (!res.ok) {
    const errBody = await res.text()
    await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — ERROR on submit. HTTP ${res.status}. Response: ${errBody.slice(0, 500)}` })

    if (res.status === 401) throw new Error(`Gamma authentication failed (401). API key is invalid or not associated with an eligible account. Ensure key starts with "sk-gamma-" and hasn't been revoked. Response: ${errBody.slice(0, 200)}`)
    if (res.status === 403) throw new Error(`Gamma access denied (403). Either insufficient credits (top up at gamma.app/settings/billing) or feature not available on your plan. Response: ${errBody.slice(0, 200)}`)
    if (res.status === 400) throw new Error(`Gamma bad request (400). Input validation failed — check inputText length (max 400K chars), enum values, and required fields. Response: ${errBody.slice(0, 300)}`)
    if (res.status === 422) throw new Error(`Gamma generation produced empty output (422). The input may be unclear or too short. Review your deck instructions. Response: ${errBody.slice(0, 200)}`)
    if (res.status === 429) throw new Error(`Gamma rate limit (429). Too many requests — wait and retry. Check Retry-After header. Response: ${errBody.slice(0, 200)}`)
    if (res.status === 500) throw new Error(`Gamma internal server error (500). Contact Gamma support with x-request-id header. Response: ${errBody.slice(0, 200)}`)
    if (res.status === 502) throw new Error(`Gamma bad gateway (502). Temporary issue — retry in a few seconds. Response: ${errBody.slice(0, 200)}`)
    throw new Error(`Gamma submit failed (${res.status}): ${errBody.slice(0, 300)}`)
  }

  const submitResponse = await res.json() as { generationId?: string; warnings?: string }

  if (!submitResponse.generationId) {
    await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — ERROR: No generationId in response. Full response: ${JSON.stringify(submitResponse).slice(0, 500)}` })
    throw new Error(`Gamma returned success but no generationId. Response: ${JSON.stringify(submitResponse).slice(0, 300)}`)
  }

  const { generationId } = submitResponse
  if (submitResponse.warnings) {
    await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — WARNING from API: ${submitResponse.warnings}` })
  }
  await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Generation started (ID: ${generationId}). Polling every 5s...` })

  // Poll for completion (up to 5 minutes = 60 polls × 5s)
  let lastStatus = ''
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5_000))

    let poll: Response
    try {
      poll = await fetch(`${BASE}/generations/${generationId}`, { headers: HEADERS })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Poll network error (attempt ${i + 1}): ${msg}. Retrying...` })
      continue // Network blip — retry on next iteration
    }

    if (!poll.ok) {
      await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Poll HTTP error: ${poll.status} (attempt ${i + 1}). Retrying...` })
      if (poll.status === 404) throw new Error(`Gamma generation not found (404). ID: ${generationId}. The generation may have been deleted or the ID is invalid.`)
      continue // Transient error — retry
    }

    const data = await poll.json() as {
      generationId?: string
      status: string
      exportUrl?: string
      gammaUrl?: string
      gammaId?: string
      credits?: { deducted?: number; remaining?: number }
      error?: { message?: string; statusCode?: number }
    }

    // Log status changes
    if (data.status !== lastStatus) {
      await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Status: ${data.status} (poll ${i + 1}, ${(i + 1) * 5}s elapsed)` })
      lastStatus = data.status
    } else if (i > 0 && i % 6 === 0) {
      await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — Still ${data.status}... ${(i + 1) * 5}s elapsed` })
    }

    if (data.status === 'completed') {
      const creditsMsg = data.credits ? ` Credits used: ${data.credits.deducted ?? '?'}, remaining: ${data.credits.remaining ?? '?'}.` : ''
      const viewMsg = data.gammaUrl ? ` View online: ${data.gammaUrl}` : ''
      await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — COMPLETED.${creditsMsg}${viewMsg}` })

      if (!data.exportUrl) {
        await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — WARNING: Generation completed but no exportUrl returned. gammaUrl: ${data.gammaUrl ?? 'none'}, gammaId: ${data.gammaId ?? 'none'}. The PPTX export may have failed silently.` })
        throw new Error(`Gamma generation completed but no export URL was returned. The deck was created (${data.gammaUrl ?? 'no URL'}) but PPTX export failed. Try exporting manually from Gamma.`)
      }

      return data.exportUrl
    }

    if (data.status === 'failed') {
      const errDetail = data.error ? `${data.error.message ?? 'No message'} (code: ${data.error.statusCode ?? '?'})` : 'No error details provided'
      const creditsMsg = data.credits ? ` Credits deducted: ${data.credits.deducted ?? '?'}` : ''
      await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — FAILED. Error: ${errDetail}.${creditsMsg}` })
      throw new Error(`Gamma generation failed: ${errDetail}`)
    }
  }

  await emit({ type: 'status', step: 'generating_deck', detail: `Gamma — TIMEOUT. Last status was "${lastStatus}" after 60 polls (5 minutes). Generation ID: ${generationId}` })
  throw new Error(`Gamma generation timed out after 5 minutes. Last status: "${lastStatus}". Generation ID: ${generationId}. You can check status manually at Gamma or retry.`)
}
