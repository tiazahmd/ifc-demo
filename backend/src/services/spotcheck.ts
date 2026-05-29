import Anthropic from '@anthropic-ai/sdk'
import type { Citation, ProgressEvent } from '../types.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface SpotVerdict {
  n: number
  url: string
  status: 'SUPPORTED' | 'UNSUPPORTED' | 'FABRICATED' | 'INACCESSIBLE'
  detail: string
}

export interface SpotCheckResult {
  verdicts: SpotVerdict[]
  failCount: number // FABRICATED + UNSUPPORTED
  passed: boolean   // failCount < 2
}

interface Fetched { state: 'ok' | 'fabricated' | 'inaccessible'; text?: string; info: string }

async function fetchUrl(url: string): Promise<Fetched> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } })
    if (res.status === 404 || res.status === 410) return { state: 'fabricated', info: `HTTP ${res.status} (page does not exist)` }
    if (!res.ok) return { state: 'inaccessible', info: `HTTP ${res.status} (likely bot-block — inconclusive)` }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('html') && !ct.includes('text')) return { state: 'inaccessible', info: `reachable but non-HTML (${ct || 'binary/PDF'}) — content not extractable, URL is real` }
    const html = await res.text()
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500)
    return { state: 'ok', text, info: 'reachable' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ERR_NAME_NOT_RESOLVED/i.test(msg)) return { state: 'fabricated', info: `domain does not resolve (${msg})` }
    return { state: 'inaccessible', info: `unreachable/timeout (${msg})` }
  } finally {
    clearTimeout(timeout)
  }
}

// Extract the report sentence around the [n] citation marker as the claim being supported.
function claimFor(report: string, n: number): string {
  const idx = report.indexOf(`[${n}]`)
  if (idx === -1) return '(citation not referenced inline in the report)'
  const start = report.lastIndexOf('.', idx) + 1
  let end = report.indexOf('.', idx)
  if (end === -1) end = idx + 200
  return report.slice(start, end + 1).replace(/\s+/g, ' ').trim().slice(0, 400)
}

function pickRandom(count: number, max: number): number[] {
  const idx = Array.from({ length: max }, (_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
  return idx.slice(0, count)
}

export async function spotCheckCitations(
  report: string,
  citations: Citation[],
  emit: (e: ProgressEvent) => Promise<void>
): Promise<SpotCheckResult> {
  const n = Math.min(4, citations.length)
  const picks = pickRandom(n, citations.length)
  await emit({ type: 'status', step: 'spotcheck', detail: `Orchestrator — Spot-checking ${n} random cited sources for fabrication/hallucination...` })

  const fetched = await Promise.all(picks.map(async (i) => ({ i, n: i + 1, url: citations[i].url, title: citations[i].title, claim: claimFor(report, i + 1), res: await fetchUrl(citations[i].url) })))

  const verdicts: SpotVerdict[] = []
  const toVerify = fetched.filter(f => f.res.state === 'ok')
  for (const f of fetched) {
    if (f.res.state === 'fabricated') verdicts.push({ n: f.n, url: f.url, status: 'FABRICATED', detail: f.res.info })
    else if (f.res.state === 'inaccessible') verdicts.push({ n: f.n, url: f.url, status: 'INACCESSIBLE', detail: f.res.info })
  }

  if (toVerify.length) {
    const items = toVerify.map(f => `### Source [${f.n}]\nURL: ${f.url}\nTitle: ${f.title ?? '(none)'}\nCLAIM IT IS CITED FOR: ${f.claim}\nPAGE EXCERPT:\n${f.res.text}`).join('\n\n')
    const prompt = `You are verifying that a research tool did not fabricate or misattribute sources. For EACH source below, decide if the page excerpt plausibly supports the claim it is cited for (or, if the claim is "(citation not referenced inline...)", whether the page is a real, topically relevant source).\n\n${items}\n\nReturn ONLY a JSON array, one object per source: [{"n":<number>,"verdict":"SUPPORTED"|"UNSUPPORTED","reason":"<short>"}]`
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    const text = msg.content.find(b => b.type === 'text')?.type === 'text' ? (msg.content.find(b => b.type === 'text') as { text: string }).text : ''
    let parsed: Array<{ n: number; verdict: string; reason: string }> = []
    try { parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { /* leave empty */ }
    for (const f of toVerify) {
      const v = parsed.find(p => p.n === f.n)
      verdicts.push({ n: f.n, url: f.url, status: v?.verdict === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'SUPPORTED', detail: v?.reason ?? 'no verdict returned' })
    }
  }

  verdicts.sort((a, b) => a.n - b.n)
  const failCount = verdicts.filter(v => v.status === 'FABRICATED' || v.status === 'UNSUPPORTED').length
  for (const v of verdicts) {
    await emit({ type: 'status', step: 'spotcheck', detail: `Orchestrator — Spot-check [${v.n}] ${v.status}: ${v.url} — ${v.detail}` })
  }
  return { verdicts, failCount, passed: failCount < 2 }
}
