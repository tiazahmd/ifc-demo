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

async function submitResearch(brief: string): Promise<string> {
  // Truncate brief to ~8000 chars — Perplexity needs a focused query, not a novel
  const truncatedBrief = brief.length > 8000 ? brief.slice(0, 8000) + '\n\n[Brief truncated for length]' : brief

  const res = await fetch(`${BASE}/v1/async/sonar`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      request: {
        model: 'sonar-deep-research',
        messages: [{ role: 'user', content: truncatedBrief }],
      }
    }),
  })
  if (res.status === 429) throw new Error('Perplexity rate limit hit on submit (429). Try again in a minute.')
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Perplexity submit failed: ${res.status} — ${body}`)
  }
  const data = await res.json() as { id?: string; status?: string; error?: string }
  if (!data.id) throw new Error(`Perplexity submit returned no job ID: ${JSON.stringify(data)}`)
  console.log(`[Perplexity] Job submitted. ID: ${data.id}, Status: ${data.status}`)
  return data.id
}

async function pollResearch(
  id: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  const start = Date.now()
  const MAX_WAIT = 30 * 60 * 1000  // 30 minutes

  while (Date.now() - start < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 10_000))

    let res: Response
    try {
      res = await fetch(`${BASE}/v1/async/sonar/${id}`, { headers: HEADERS })
    } catch {
      await emit({ type: 'status', step: 'researching', detail: 'Perplexity — Network error. Retrying...' })
      continue
    }

    if (res.status === 429) {
      await emit({ type: 'status', step: 'researching', detail: 'Perplexity — Rate limit (429). Waiting 30s...' })
      await new Promise(r => setTimeout(r, 30_000))
      continue
    }

    if (!res.ok) throw new Error(`Perplexity poll failed: ${res.status}`)

    const data = await res.json() as {
      status: string
      response?: {
        choices: Array<{ message: { content: string } }>
        citations?: string[]
        search_results?: Array<{ title: string; url: string; snippet?: string }>
        usage?: {
          num_search_queries: number
          completion_tokens: number
          total_tokens: number
          cost?: { total_cost: number }
          total_cost?: number  // fallback
        }
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000)

    if (data.status === 'FAILED') throw new Error('Perplexity research failed')

    if (data.status === 'COMPLETED' && data.response) {
      const r = data.response
      const report = r.choices[0].message.content
      const sourceCount = r.search_results?.length ?? r.citations?.length ?? 0
      const cost = (r.usage?.cost?.total_cost ?? r.usage?.total_cost ?? 0).toFixed(2)
      const tokens = r.usage?.completion_tokens ?? 0
      const totalCostNum = r.usage?.cost?.total_cost ?? r.usage?.total_cost ?? 0

      await emit({
        type: 'status', step: 'researching',
        detail: `Perplexity — COMPLETED. ${sourceCount} sources. ${tokens} tokens. Cost: $${cost}`
      })

      if (r.search_results?.length) {
        const citationLines = r.search_results
          .map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`)
          .join('\n')
        await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
      }

      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report:\n${report}` })

      if (report.length < 2000 || sourceCount < 5) throw new ThinResearchError(`Only ${sourceCount} sources found`)

      const citations: Citation[] = (r.search_results ?? []).map(s => ({
        url: s.url, title: s.title, snippet: s.snippet
      }))

      return { report, citations, sourceCount, costUSD: totalCostNum }
    }

    // IN_PROGRESS — update single line, don't spam new entries
    await emit({
      type: 'status', step: 'researching',
      detail: `Perplexity — Researching... ${elapsed}s elapsed`
    })
  }

  throw new Error('Perplexity research timed out after 30 minutes')
}

export async function runDeepResearch(
  brief: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  let currentBrief = brief

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await emit({
        type: 'status', step: 'retry',
        detail: `Retry ${attempt - 1}/3 — Research too thin. Adjusting research strategy...`
      })
      currentBrief = `${brief}\n\nIMPORTANT: The previous research attempt returned insufficient results. Please broaden your search scope, use alternative source types, and focus on any publicly available information about this company and sector.`
    }

    try {
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research job submitted (attempt ${attempt}). Polling...` })
      const id = await submitResearch(currentBrief)
      return await pollResearch(id, emit)
    } catch (err) {
      if (err instanceof ThinResearchError && attempt < 3) continue
      throw err
    }
  }

  throw new Error('Research failed after 3 attempts')
}
