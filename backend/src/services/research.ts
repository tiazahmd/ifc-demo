import type { Citation, ProgressEvent } from '../types.js'

// Confirmed response structure from direct API test:
// { id, model, created, usage: { cost: { total_cost } }, citations: string[], search_results: [{title,url,snippet}], choices: [{message:{content}}] }

const BASE = 'https://api.perplexity.ai'

interface PerplexityResponse {
  model?: string
  choices: Array<{ message: { content: string }; finish_reason: string }>
  citations?: string[]
  search_results?: Array<{ title: string; url: string; snippet?: string; source?: string }>
  usage?: {
    completion_tokens: number
    reasoning_tokens?: number
    cost?: { total_cost: number }
  }
}

interface ResearchResult {
  report: string
  citations: Citation[]
  sourceCount: number
  costUSD: number
}

class ThinResearchError extends Error {}

export async function runDeepResearch(brief: string, emit: (e: ProgressEvent) => Promise<void>): Promise<ResearchResult> {
  const truncatedBrief = brief.length > 8000 ? brief.slice(0, 8000) + '\n\n[Brief truncated]' : brief

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await emit({ type: 'status', step: 'retry', detail: `Retry ${attempt - 1}/3 — Research too thin. Adjusting strategy...` })
    }

    const currentBrief = attempt > 1
      ? `${truncatedBrief}\n\nIMPORTANT: Previous attempt returned insufficient results. Broaden search scope.`
      : truncatedBrief

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Starting deep research (attempt ${attempt}). Takes 2-5 minutes...` })

    let res: Response
    try {
      res = await fetch(`${BASE}/v1/sonar`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar-deep-research',
          messages: [{ role: 'user', content: currentBrief }],
        }),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Network error: ${msg}` })
      if (attempt < 3) continue
      throw new Error(`Perplexity network error: ${msg}`)
    }

    if (res.status === 429) throw new Error('Perplexity rate limit (429). Try again in a minute.')

    if (!res.ok) {
      const errBody = await res.text()
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — HTTP ${res.status}: ${errBody.slice(0, 200)}` })
      if (attempt < 3) continue
      throw new Error(`Perplexity failed: ${res.status}`)
    }

    const data = await res.json() as PerplexityResponse

    const report = data.choices?.[0]?.message?.content ?? ''
    // search_results has full objects; citations is flat URL array — check both
    const sourceCount = (data.search_results?.length ?? 0) || (data.citations?.length ?? 0)
    const totalCostNum = data.usage?.cost?.total_cost ?? 0
    const tokens = data.usage?.completion_tokens ?? 0
    const model = data.model ?? 'unknown'

    await emit({
      type: 'status', step: 'researching',
      detail: `Perplexity — COMPLETED. Model: ${model}. ${sourceCount} sources. ${tokens} tokens. Cost: $${totalCostNum.toFixed(2)}`
    })

    if (data.search_results?.length) {
      const citationLines = data.search_results
        .map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`)
        .join('\n')
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
    }

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report (${report.length} chars):` })
    const CHUNK = 3000
    for (let i = 0; i < report.length; i += CHUNK) {
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Report (${Math.floor(i/CHUNK)+1}/${Math.ceil(report.length/CHUNK)}):\n${report.slice(i, i + CHUNK)}` })
    }

    if (report.length < 2000 || sourceCount < 5) {
      if (attempt < 3) { throw new ThinResearchError(`Only ${sourceCount} sources`) }
      throw new Error(`Research too thin after 3 attempts`)
    }

    // Use search_results if available (has title/snippet), fall back to citations (URL strings)
    const citations: Citation[] = data.search_results?.length
      ? data.search_results.map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
      : (data.citations ?? []).map(url => ({ url }))

    return { report, citations, sourceCount, costUSD: totalCostNum }
  }

  throw new Error('Research failed after 3 attempts')
}
