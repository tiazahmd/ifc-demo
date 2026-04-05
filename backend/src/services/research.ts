import type { Citation, ProgressEvent } from '../types.js'

const BASE = 'https://api.perplexity.ai'

interface PerplexityResponse {
  model?: string
  choices: Array<{ message: { content: string }; finish_reason: string }>
  citations?: string[]
  search_results?: Array<{ title: string; url: string; snippet?: string }>
  usage?: { completion_tokens: number; cost?: { total_cost: number } }
}

interface ResearchResult {
  report: string
  citations: Citation[]
  sourceCount: number
  costUSD: number
}

// Single Perplexity attempt — retry logic and quality judgment live in the orchestrator.
export async function attemptResearch(
  brief: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<ResearchResult> {
  const truncatedBrief = brief.length > 8000 ? brief.slice(0, 8000) + '\n\n[Brief truncated]' : brief

  const res = await fetch(`${BASE}/v1/sonar`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-deep-research',
      messages: [{ role: 'user', content: truncatedBrief }],
    }),
  })

  if (res.status === 429) throw new Error('Perplexity rate limit (429). Try again in a minute.')
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Perplexity HTTP ${res.status}: ${errBody.slice(0, 300)}`)
  }

  const rawText = await res.text()
  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Raw response (${rawText.length} chars): ${rawText.slice(0, 200)}` })

  const data = JSON.parse(rawText) as PerplexityResponse
  const report = data.choices?.[0]?.message?.content ?? ''
  const sourceCount = (data.search_results?.length ?? 0) || (data.citations?.length ?? 0)
  const totalCostNum = data.usage?.cost?.total_cost ?? 0
  const tokens = data.usage?.completion_tokens ?? 0
  const model = data.model ?? 'unknown'

  await emit({ type: 'status', step: 'researching', detail: `Perplexity — COMPLETED. Model: ${model}. ${sourceCount} sources. ${tokens} tokens. Cost: $${totalCostNum.toFixed(2)}` })

  if (data.search_results?.length) {
    const citationLines = data.search_results.map((s, i) => `[${i + 1}] ${s.title ?? 'Source'}\n    ${s.url}`).join('\n')
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Sources (${sourceCount}):\n${citationLines}` })
  }

  await emit({ type: 'status', step: 'researching', detail: `Perplexity — Research Report (${report.length} chars):` })
  const CHUNK = 3000
  for (let i = 0; i < report.length; i += CHUNK) {
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Report (${Math.floor(i / CHUNK) + 1}/${Math.ceil(report.length / CHUNK)}):\n${report.slice(i, i + CHUNK)}` })
  }

  const citations: Citation[] = data.search_results?.length
    ? data.search_results.map(s => ({ url: s.url, title: s.title, snippet: s.snippet }))
    : (data.citations ?? []).map(url => ({ url }))

  return { report, citations, sourceCount, costUSD: totalCostNum }
}
