import type { Citation, ProgressEvent } from '../types.js'

// NOTE: Correct base URL is without /v1 for async endpoints
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

  dbg(`Submitting. Brief: ${truncatedBrief.length} chars`)
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Submitting job. Brief: ${truncatedBrief.length} chars` })

  const res = await fetch(`${BASE}/async/chat/completions`, {
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
  dbg(`Submit: HTTP ${res.status} | ${rawBody.slice(0, 300)}`)
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Submit: HTTP ${res.status} | ${rawBody.slice(0, 300)}` })

  if (res.status === 429) throw new Error('Perplexity rate limit (429). Try again in a minute.')
  if (!res.ok) throw new Error(`Perplexity submit failed: ${res.status} — ${rawBody}`)

  const data = JSON.parse(rawBody) as { id?: string; status?: string }
  if (!data.id) throw new Error(`No job ID returned: ${rawBody}`)

  dbg(`Job ID: ${data.id}, status: ${data.status}`)
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Job ID: ${data.id} | Status: ${data.status}` })
  return data.id
}

async function pollResearch(id: string, emit: (e: ProgressEvent) => Promise<void>): Promise<ResearchResult> {
  const start = Date.now()
  const MAX_WAIT = 30 * 60 * 1000
  let pollCount = 0

  while (Date.now() - start < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 10_000))
    pollCount++
    const elapsed = Math.round((Date.now() - start) / 1000)

    // WORKAROUND: Known Perplexity bug — GET /async/chat/completions/{id} returns list instead of single item
    // and shows IN_PROGRESS even when COMPLETED. Use LIST endpoint and filter by ID instead.
    let res: Response
    let rawBody: string
    try {
      res = await fetch(`${BASE}/async/chat/completions?limit=20`, { headers: HEADERS })
      rawBody = await res.text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Poll #${pollCount} network error: ${msg}` })
      continue
    }

    dbg(`Poll #${pollCount} (${elapsed}s): HTTP ${res.status} | ${rawBody.slice(0, 300)}`)
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Poll #${pollCount} (${elapsed}s): HTTP ${res.status} | ${rawBody.slice(0, 400)}` })

    if (res.status === 429) {
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Rate limit (429). Waiting 30s...` })
      await new Promise(r => setTimeout(r, 30_000))
      continue
    }

    if (!res.ok) throw new Error(`Poll failed: HTTP ${res.status} — ${rawBody}`)

    type Job = { id: string; status: string; error_message?: string; response?: unknown }
    let jobs: Job[]
    try {
      const parsed = JSON.parse(rawBody)
      jobs = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.results ?? [parsed])
    } catch {
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Parse error: ${rawBody.slice(0, 200)}` })
      continue
    }

    const job = jobs.find(j => j.id === id)
    if (!job) {
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Job ${id} not in list of ${jobs.length}. IDs: ${jobs.map(j => j.id).slice(0, 5).join(', ')}` })
      continue
    }

    dbg(`Job status: ${job.status}`)

    if (job.status === 'FAILED') {
      const errMsg = job.error_message ?? 'No error message'
      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Job FAILED: ${errMsg}` })
      throw new Error(`Perplexity job failed: ${errMsg}`)
    }

    if (job.status === 'COMPLETED' && job.response) {
      const r = job.response as {
        choices: Array<{ message: { content: string } }>
        citations?: string[]
        search_results?: Array<{ title: string; url: string; snippet?: string }>
        usage?: { completion_tokens: number; cost?: { total_cost: number }; total_cost?: number }
      }
      const report = r.choices[0].message.content
      const sourceCount = r.search_results?.length ?? r.citations?.length ?? 0
      const totalCostNum = r.usage?.cost?.total_cost ?? r.usage?.total_cost ?? 0
      const tokens = r.usage?.completion_tokens ?? 0

      await emit({ type: 'status', step: 'researching', detail: `Perplexity — COMPLETED. ${sourceCount} sources. ${tokens} tokens. Cost: $${totalCostNum.toFixed(2)}` })

      if (r.search_results?.length) {
        const citationLines = r.search_results.map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`).join('\n')
        await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
      }

      await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report:\n${report}` })

      if (report.length < 2000 || sourceCount < 5) throw new ThinResearchError(`Only ${sourceCount} sources found`)

      const citations: Citation[] = (r.search_results ?? []).map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
      return { report, citations, sourceCount, costUSD: totalCostNum }
    }

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Researching... ${elapsed}s (poll #${pollCount}, status: ${job.status})` })
  }

  throw new Error('Perplexity timed out after 30 minutes')
}

export async function runDeepResearch(brief: string, emit: (e: ProgressEvent) => Promise<void>): Promise<ResearchResult> {
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
