import type { Citation, ProgressEvent } from '../types.js'

const BASE = 'https://api.perplexity.ai'
const HEADERS = {
  'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
  'Content-Type': 'application/json',
}

interface ResearchResult {
  report: string
  citations: Citation[]
  sourceCount: number
  costUSD: number
}

class ThinResearchError extends Error {}

export async function runDeepResearch(brief: string, emit: (e: ProgressEvent) => Promise<void>): Promise<ResearchResult> {
  // NOTE: Perplexity's async API (/v1/async/sonar) is currently broken — the GET endpoint
  // returns a list instead of the single result, and the response content is never retrievable.
  // Community bug reports filed April 2, 2026. Using synchronous endpoint instead.
  const truncatedBrief = brief.length > 8000 ? brief.slice(0, 8000) + '\n\n[Brief truncated]' : brief

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await emit({ type: 'status', step: 'retry', detail: `Retry ${attempt - 1}/3 — Research too thin. Adjusting strategy...` })
    }

    const currentBrief = attempt > 1
      ? `${truncatedBrief}\n\nIMPORTANT: Previous attempt returned insufficient results. Broaden search scope.`
      : truncatedBrief

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Submitting synchronous deep research (attempt ${attempt}). This takes 2-5 minutes...` })

    let res: Response
    let rawBody: string
    try {
      res = await fetch(`${BASE}/v1/sonar`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          model: 'sonar-deep-research',
          messages: [{ role: 'user', content: currentBrief }],
        }),
      })
      rawBody = await res.text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Network error: ${msg}` })
      if (attempt < 3) continue
      throw new Error(`Perplexity network error: ${msg}`)
    }

    console.log(`[Perplexity] HTTP ${res.status} | ${rawBody.slice(0, 300)}`)
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Response: HTTP ${res.status} | ${rawBody.slice(0, 300)}` })

    if (res.status === 429) throw new Error('Perplexity rate limit (429). Try again in a minute.')
    if (!res.ok) throw new Error(`Perplexity failed: ${res.status} — ${rawBody.slice(0, 200)}`)

    const data = JSON.parse(rawBody) as {
      choices: Array<{ message: { content: string } }>
      citations?: string[]
      search_results?: Array<{ title: string; url: string; snippet?: string }>
      usage?: { completion_tokens: number; cost?: { total_cost: number }; total_cost?: number }
    }

    const report = data.choices?.[0]?.message?.content ?? ''
    const sourceCount = data.search_results?.length ?? data.citations?.length ?? 0
    const totalCostNum = data.usage?.cost?.total_cost ?? data.usage?.total_cost ?? 0
    const tokens = data.usage?.completion_tokens ?? 0

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — COMPLETED. ${sourceCount} sources. ${tokens} tokens. Cost: $${totalCostNum.toFixed(2)}` })

    if (data.search_results?.length) {
      const citationLines = data.search_results.map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`).join('\n')
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
    }

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report:\n${report}` })

    if (report.length < 2000 || sourceCount < 5) {
      if (attempt < 3) throw new ThinResearchError(`Only ${sourceCount} sources`)
      throw new Error(`Research too thin after 3 attempts: ${sourceCount} sources`)
    }

    const citations: Citation[] = (data.search_results ?? []).map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
    return { report, citations, sourceCount, costUSD: totalCostNum }
  }

  throw new Error('Research failed after 3 attempts')
}
