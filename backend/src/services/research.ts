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

function dbg(msg: string) {
  console.log(`[DEBUG ${new Date().toISOString()}] ${msg}`)
}

async function submitResearch(brief: string, emit: (e: ProgressEvent) => Promise<void>): Promise<string> {
  const truncatedBrief = brief.length > 8000 ? brief.slice(0, 8000) + '\n\n[Brief truncated]' : brief

  dbg(`Submitting to Perplexity. Brief length: ${truncatedBrief.length} chars`)
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Submitting job. Brief: ${truncatedBrief.length} chars` })

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

  const rawBody = await res.text()
  dbg(`Submit response: status=${res.status} body=${rawBody}`)
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Submit response: HTTP ${res.status} | ${rawBody.slice(0, 300)}` })

  if (res.status === 429) throw new Error('Perplexity rate limit (429). Try again in a minute.')
  if (!res.ok) throw new Error(`Perplexity submit failed: ${res.status} — ${rawBody}`)

  const data = JSON.parse(rawBody) as { id?: string; status?: string; error?: string }
  if (!data.id) throw new Error(`No job ID returned: ${rawBody}`)

  dbg(`Job ID: ${data.id}, initial status: ${data.status}`)
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Job ID: ${data.id} | Initial status: ${data.status}` })

  return data.id
}

async function pollResearch(
  id: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  const start = Date.now()
  const MAX_WAIT = 30 * 60 * 1000
  let pollCount = 0

  while (Date.now() - start < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 10_000))
    pollCount++
    const elapsed = Math.round((Date.now() - start) / 1000)

    let res: Response
    let rawBody: string
    try {
      res = await fetch(`${BASE}/v1/async/sonar/${id}`, { headers: HEADERS })
      rawBody = await res.text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dbg(`Poll #${pollCount} network error: ${msg}`)
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Poll #${pollCount} network error: ${msg}` })
      continue
    }

    dbg(`Poll #${pollCount} (${elapsed}s): HTTP ${res.status} | ${rawBody.slice(0, 200)}`)

    // Emit raw poll response on EVERY poll so we can see the structure
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Poll #${pollCount} (${elapsed}s): HTTP ${res.status} | ${rawBody.slice(0, 500)}` })

    if (res.status === 429) {
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Rate limit (429). Waiting 30s...` })
      await new Promise(r => setTimeout(r, 30_000))
      continue
    }

    if (!res.ok) throw new Error(`Poll failed: HTTP ${res.status} — ${rawBody}`)

    const data = JSON.parse(rawBody) as {
      status: string
      error_message?: string
      response?: {
        choices: Array<{ message: { content: string } }>
        citations?: string[]
        search_results?: Array<{ title: string; url: string; snippet?: string }>
        usage?: {
          num_search_queries: number
          completion_tokens: number
          total_tokens: number
          cost?: { total_cost: number }
          total_cost?: number
        }
      }
    }

    if (data.status === 'FAILED') {
      const errMsg = data.error_message ?? 'No error message'
      dbg(`Job FAILED: ${errMsg}`)
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Job FAILED: ${errMsg}` })
      throw new Error(`Perplexity job failed: ${errMsg}`)
    }

    if (data.status === 'COMPLETED' && data.response) {
      const r = data.response
      const report = r.choices[0].message.content
      const sourceCount = r.search_results?.length ?? r.citations?.length ?? 0
      const totalCostNum = r.usage?.cost?.total_cost ?? r.usage?.total_cost ?? 0
      const cost = totalCostNum.toFixed(2)
      const tokens = r.usage?.completion_tokens ?? 0

      dbg(`COMPLETED. Sources: ${sourceCount}, tokens: ${tokens}, cost: $${cost}`)
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — COMPLETED. ${sourceCount} sources. ${tokens} tokens. Cost: $${cost}` })

      if (r.search_results?.length) {
        const citationLines = r.search_results.map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`).join('\n')
        await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
      }

      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report:\n${report}` })

      if (report.length < 2000 || sourceCount < 5) throw new ThinResearchError(`Only ${sourceCount} sources found`)

      const citations: Citation[] = (r.search_results ?? []).map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
      return { report, citations, sourceCount, costUSD: totalCostNum }
    }

    // Still IN_PROGRESS
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Researching... ${elapsed}s elapsed (poll #${pollCount}, status: ${data.status})` })
  }

  throw new Error('Perplexity timed out after 30 minutes')
}

export async function runDeepResearch(
  brief: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  let currentBrief = brief

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await emit({ type: 'status', step: 'retry', detail: `Retry ${attempt - 1}/3 — Research too thin. Adjusting strategy...` })
      currentBrief = `${brief}\n\nIMPORTANT: Previous attempt returned insufficient results. Broaden search scope.`
    }

    try {
      const id = await submitResearch(currentBrief, emit)
      return await pollResearch(id, emit)
    } catch (err) {
      if (err instanceof ThinResearchError && attempt < 3) continue
      throw err
    }
  }

  throw new Error('Research failed after 3 attempts')
}
