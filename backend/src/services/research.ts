import type { Citation, ProgressEvent } from '../types.js'

const BASE = 'https://api.perplexity.ai'

interface PerplexityUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  citation_tokens?: number
  num_search_queries?: number
  reasoning_tokens?: number
  cost?: { total_cost: number }
}

interface PerplexityResponse {
  id?: string
  model?: string
  object?: string
  created?: number
  choices: Array<{ message: { content: string }; finish_reason: string }>
  citations?: string[]
  search_results?: Array<{ title: string; url: string; date?: string; snippet?: string; source?: string }>
  usage?: PerplexityUsage
  [key: string]: unknown  // catch any fields we haven't typed
}

interface ResearchResult {
  report: string
  citations: Citation[]
  sourceCount: number
  numSearchQueries: number
  costUSD: number
}

// Single Perplexity attempt — retry logic and quality judgment live in the orchestrator.
export async function attemptResearch(
  brief: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  const truncatedBrief = brief.length > 12000 ? brief.slice(0, 12000) + '\n\n[Brief truncated]' : brief

  const TIMEOUT_MS = 8 * 60 * 1000 // 8 minutes max for deep research
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // Emit progress pings every 30s so the frontend knows we're alive
  let elapsed = 0
  const ticker = setInterval(async () => {
    elapsed += 30
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Deep research in progress... ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed` })
  }, 30_000)

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
        messages: [{ role: 'user', content: truncatedBrief }],
      }),
      signal: controller.signal,
    })
  } catch (err: unknown) {
    clearTimeout(timeout)
    clearInterval(ticker)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Perplexity deep research timed out after ${TIMEOUT_MS / 60000} minutes. The query may be too complex or Perplexity may be experiencing delays.`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
    clearInterval(ticker)
  }

  if (res.status === 429) throw new Error('Perplexity rate limit hit (429). Too many requests — wait 60 seconds and retry.')
  if (res.status === 401) throw new Error('Perplexity API key invalid or expired (401). Check PERPLEXITY_API_KEY on Render.')
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Perplexity HTTP ${res.status}: ${errBody.slice(0, 300)}`)
  }

  const rawText = await res.text()
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Raw response (${rawText.length} chars): ${rawText.slice(0, 200)}` })

  const data = JSON.parse(rawText) as PerplexityResponse

  // ── DEBUG: Log response structure so we can diagnose citation extraction ──
  const topKeys = Object.keys(data)
  const citationsLen = data.citations?.length ?? 'undefined'
  const searchResultsLen = data.search_results?.length ?? 'undefined'
  const numSearchQueries = data.usage?.num_search_queries ?? 'undefined'
  const citationTokens = data.usage?.citation_tokens ?? 'undefined'

  await emit({ type: 'status', step: 'researching', detail:
    `Perplexity — DEBUG response structure:\n` +
    `  Top-level keys: [${topKeys.join(', ')}]\n` +
    `  citations (string[] of URLs): ${citationsLen}\n` +
    `  search_results (object[]): ${searchResultsLen}\n` +
    `  usage.num_search_queries: ${numSearchQueries}\n` +
    `  usage.citation_tokens: ${citationTokens}`
  })

  // If citations exist, log first 3 for verification
  if (data.citations?.length) {
    await emit({ type: 'status', step: 'researching', detail:
      `Perplexity — First 3 citations: ${data.citations.slice(0, 3).join('\n  ')}`
    })
  }
  if (data.search_results?.length) {
    const preview = data.search_results.slice(0, 3).map(s => `${s.title} — ${s.url}`).join('\n  ')
    await emit({ type: 'status', step: 'researching', detail:
      `Perplexity — First 3 search_results: ${preview}`
    })
  }

  const report = data.choices?.[0]?.message?.content ?? ''

  // Source count: prefer search_results, fall back to citations array
  const sourceCount = (data.search_results?.length ?? 0) || (data.citations?.length ?? 0)

  const totalCostNum = data.usage?.cost?.total_cost ?? 0
  const tokens = data.usage?.completion_tokens ?? 0
  const model = data.model ?? 'unknown'

  await emit({ type: 'status', step: 'researching', detail:
    `Perplexity — COMPLETED. Model: ${model}. ${sourceCount} sources. ` +
    `${numSearchQueries} search queries. ${tokens} tokens. Cost: $${totalCostNum.toFixed(2)}`
  })

  if (data.search_results?.length) {
    const citationLines = data.search_results.map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`).join('\n')
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
  }

  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report (${report.length} chars):` })
  const CHUNK = 3000
  for (let i = 0; i < report.length; i += CHUNK) {
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Report (${Math.floor(i / CHUNK) + 1}/${Math.ceil(report.length / CHUNK)}):\n${report.slice(i, i + CHUNK)}` })
  }

  // Build citations: prefer search_results (richer), fall back to citations (URL strings)
  const citations: Citation[] = data.search_results?.length
    ? data.search_results.map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
    : (data.citations ?? []).map(url => ({ url }))

  return { report, citations, sourceCount, numSearchQueries: data.usage?.num_search_queries ?? 0, costUSD: totalCostNum }
}
