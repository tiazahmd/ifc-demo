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
}

class ThinResearchError extends Error {}

async function submitResearch(brief: string): Promise<string> {
  const res = await fetch(`${BASE}/v1/async/sonar`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      request: {
        model: 'sonar-deep-research',
        messages: [{ role: 'user', content: brief }],
        reasoning_effort: 'high',
      }
    }),
  })
  if (!res.ok) throw new Error(`Perplexity submit failed: ${res.status}`)
  const data = await res.json() as { id: string }
  return data.id
}

async function pollResearch(
  id: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  const start = Date.now()
  const MAX_WAIT = 15 * 60 * 1000

  while (Date.now() - start < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 10_000))

    const res = await fetch(`${BASE}/v1/async/sonar/${id}`, { headers: HEADERS })
    if (!res.ok) throw new Error(`Perplexity poll failed: ${res.status}`)
    const data = await res.json() as {
      status: string
      response?: {
        choices: Array<{ message: { content: string } }>
        citations?: string[]
        search_results?: Array<{ title: string; url: string; snippet?: string }>
        usage?: { num_search_queries: number; completion_tokens: number; total_cost: number }
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000)

    if (data.status === 'COMPLETED' && data.response) {
      const r = data.response
      const report = r.choices[0].message.content
      const sourceCount = r.search_results?.length ?? r.citations?.length ?? 0
      const cost = r.usage?.total_cost?.toFixed(2) ?? '?'
      const tokens = r.usage?.completion_tokens ?? 0

      await emit({
        type: 'status', step: 'researching',
        detail: `Perplexity — COMPLETED. ${sourceCount} sources. ${tokens} tokens. Cost: $${cost}`
      })

      if (report.length < 2000 || sourceCount < 5) throw new ThinResearchError(`Only ${sourceCount} sources found`)

      const citations: Citation[] = (r.search_results ?? []).map(s => ({
        url: s.url, title: s.title, snippet: s.snippet
      }))

      return { report, citations, sourceCount }
    }

    await emit({
      type: 'status', step: 'researching',
      detail: `Perplexity — IN_PROGRESS. Elapsed: ${elapsed}s`
    })
  }

  throw new Error('Perplexity research timed out after 15 minutes')
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
      // Broaden the brief on retry
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
