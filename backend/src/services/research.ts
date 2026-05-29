import type { Citation, ProgressEvent } from '../types.js'

const BASE = 'https://api.perplexity.ai'

interface PerplexityUsage {
  completion_tokens?: number
  num_search_queries?: number
  citation_tokens?: number
  cost?: { total_cost: number }
}

interface PerplexityResponse {
  model?: string
  choices: Array<{ message: { content: string }; finish_reason?: string }>
  citations?: string[]
  search_results?: Array<{ title?: string; url: string; snippet?: string }>
  usage?: PerplexityUsage
}

interface AsyncJob {
  id: string
  status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  response?: PerplexityResponse
  error_message?: string | null
}

export interface ResearchResult {
  report: string
  citations: Citation[]
  sourceCount: number
  numSearchQueries: number
  costUSD: number
  grounded: boolean
  groundingReason?: string
}

// Phrases that prove the model answered from training data instead of live web research.
const FAILURE_PHRASES = [
  'not possible to crawl', 'web search is not available', 'real-time web search is not available',
  'no pre-fetched search results', 'knowledge cutoff', 'general background knowledge up to',
  'without access to', 'unable to browse', 'do not have access to', 'cannot access external',
]

// sonar-deep-research prepends a <think>…</think> reasoning trace — strip it.
function stripThink(s: string): string {
  if (!s.includes('</think>')) return s
  return s.replace(/^[\s\S]*?<\/think>\s*/, '').trim() || s
}

function assessGrounding(report: string, sourceCount: number): { grounded: boolean; reason?: string } {
  if (sourceCount === 0) return { grounded: false, reason: 'Perplexity returned 0 cited sources' }
  if (!/\[\d+\]/.test(report)) return { grounded: false, reason: 'Report contains no inline [N] citation markers' }
  const lc = report.toLowerCase()
  const hit = FAILURE_PHRASES.find(p => lc.includes(p))
  if (hit) return { grounded: false, reason: `Report admits it lacked live web access: "${hit}"` }
  return { grounded: true }
}

const authHeaders = () => ({ Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' })

// Single Perplexity deep-research attempt via the async API (no connection timeouts).
export async function attemptResearch(
  brief: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  const truncatedBrief = brief.length > 12000 ? brief.slice(0, 12000) + '\n\n[Brief truncated]' : brief

  // ── Submit async job ──────────────────────────────────────────────────────
  const submitRes = await fetch(`${BASE}/v1/async/sonar`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      request: {
        model: 'sonar-deep-research',
        messages: [{ role: 'user', content: truncatedBrief }],
        search_mode: 'web',       // pin to live web sources
        disable_search: false,    // never answer from training data alone
        reasoning_effort: 'high', // thorough deep research
      },
    }),
  })
  if (submitRes.status === 401) throw new Error('Perplexity API key invalid or expired (401).')
  if (submitRes.status === 429) throw new Error('Perplexity rate limit hit (429). Wait and retry.')
  if (!submitRes.ok) throw new Error(`Perplexity submit HTTP ${submitRes.status}: ${(await submitRes.text()).slice(0, 300)}`)

  const submitted = await submitRes.json() as AsyncJob
  const jobId = submitted.id
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Async deep-research job submitted (${jobId}). reasoning_effort=high, search_mode=web. Polling...` })

  // ── Poll until COMPLETED / FAILED ─────────────────────────────────────────
  const POLL_MS = 15_000
  const MAX_MS = 25 * 60 * 1000
  let job = submitted
  let elapsed = 0
  while (job.status !== 'COMPLETED' && job.status !== 'FAILED') {
    await new Promise(r => setTimeout(r, POLL_MS))
    elapsed += POLL_MS
    if (elapsed > MAX_MS) throw new Error('Perplexity async job exceeded 25 minutes — aborting poll.')
    const pollRes = await fetch(`${BASE}/v1/async/sonar/${jobId}`, { headers: authHeaders() })
    if (!pollRes.ok) throw new Error(`Perplexity poll HTTP ${pollRes.status}`)
    job = await pollRes.json() as AsyncJob
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Deep research ${job.status.toLowerCase()}... ${Math.floor(elapsed / 60000)}m ${(elapsed / 1000) % 60}s elapsed` })
  }

  if (job.status === 'FAILED') throw new Error(`Perplexity job FAILED: ${job.error_message ?? 'no error message'}`)
  const data = job.response
  if (!data) throw new Error('Perplexity job COMPLETED but returned no response body.')

  const report = stripThink(data.choices?.[0]?.message?.content ?? '')
  const sourceCount = (data.search_results?.length ?? 0) || (data.citations?.length ?? 0)
  const numSearchQueries = data.usage?.num_search_queries ?? 0
  const costUSD = data.usage?.cost?.total_cost ?? 0
  const citations: Citation[] = data.search_results?.length
    ? data.search_results.map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
    : (data.citations ?? []).map(url => ({ url }))

  const { grounded, reason } = assessGrounding(report, sourceCount)

  await emit({ type: 'status', step: 'researching', detail:
    `Perplexity — Completed. ${sourceCount} sources · ${numSearchQueries} searches · $${costUSD.toFixed(2)} · grounded=${grounded}${reason ? ` (${reason})` : ''}` })

  // Stream the report so the frontend captures it as a downloadable artifact.
  const CHUNK = 3000
  for (let i = 0; i < report.length; i += CHUNK) {
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Report (${Math.floor(i / CHUNK) + 1}/${Math.ceil(report.length / CHUNK)}):\n${report.slice(i, i + CHUNK)}` })
  }

  return { report, citations, sourceCount, numSearchQueries, costUSD, grounded, groundingReason: reason }
}
