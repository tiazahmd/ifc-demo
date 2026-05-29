import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { UserInput, ProgressEvent } from '../types.js'
import { attemptResearch } from './research.js'
import { spotCheckCitations } from './spotcheck.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'
const THINKING = { type: 'enabled' as const, budget_tokens: 10000 }
const MAX_TOKENS = 64000

const SYSTEM = `You are an IFC advisory orchestrator producing a sell-side advisory pitch deck (convincing a client to hire IFC to raise capital). You run two phases: (1) write a research brief for Perplexity deep research, (2) write Gamma deck instructions from the verified research.

**Phase 1 — Research Brief**
Produce a focused, specific research brief for Perplexity deep research, in THREE sections:

**SECTION 1 — Company Intelligence**: corporate identity (legal name, founding, HQ, ownership, shareholders), leadership, business model & exact sub-sector, geographic footprint, project portfolio (operational AND pipeline), strategic direction, recent news (last 2 years). If a website URL is given, instruct Perplexity to crawl it (About, Projects, Team, Investors pages). If documents are uploaded, reference their facts and ask Perplexity to verify and expand them with public sources.

**SECTION 2 — IFC Track Record in the Sector**: search disclosures.ifc.org and "IFC [sector] [region]" for 8-12 projects — name, country, year, IFC commitment (USD), one-liner.

**SECTION 3 — Sector Investor Landscape**: 15-20 active investors by category (DFI, PE, Sovereign, Impact, Strategic) — name, country, AUM/fund size, 1-2 line description.

**CRITICAL GROUNDING RULES — you MUST place these verbatim as BOTH the very FIRST block AND the very LAST block of the brief you write (bookend the brief so Perplexity cannot miss them):**
- "Use LIVE web research ONLY. Do NOT answer from training data, prior knowledge, or general background. Every single fact must come from a source you retrieved in THIS session via web search."
- "Run COMPREHENSIVE web searches across every section BEFORE writing anything. Do not begin composing the report until you have actually executed the searches and gathered real, citable sources."
- "Cite every data point with Perplexity's native numbered citation markers [1], [2], etc. mapped to your search_results. Do NOT use markdown hyperlinks or footnotes."
- "Returning 0 cited sources — or ANY claim not backed by a retrieved source — is an automatic FAILURE. An empty, uncited, or 'based on general knowledge / training data' report is unacceptable and WILL BE REJECTED outright. If live web search is unavailable, STOP and explicitly state that search failed — do NOT fall back to prior knowledge or fabricate."

The opening block should be headed "CRITICAL GROUNDING RULES — READ BEFORE EXECUTING ANY SEARCH". The closing block should be headed "FINAL REMINDER BEFORE YOU RESPOND" and restate that zero sources = rejected and every claim must carry a live [N] citation.

Do NOT impose a word limit — be as comprehensive as the sources allow. Do NOT ask for macro/country data. Output ONLY the brief, no preamble.

**Phase 2 — Deck Instructions**
When asked, produce structured markdown deck instructions for Gamma AI following the slide structure provided in that prompt, using only the verified research supplied.`

function buildPhase1Prompt(input: UserInput, fileContents: string[]): string {
  return [
    `Company: ${input.companyName}`,
    `Country: ${input.country}`,
    `Sector: ${input.sector}`,
    `Engagement Type: ${input.engagementType}`,
    input.companyWebsite ? `Website: ${input.companyWebsite}` : '',
    input.additionalLinks?.length ? `Additional links:\n${input.additionalLinks.join('\n')}` : '',
    input.additionalInstructions ? `Analyst instructions: ${input.additionalInstructions}` : '',
    fileContents.length ? `\n--- Uploaded Documents ---\n${fileContents.join('\n\n')}` : '',
  ].filter(Boolean).join('\n')
}

function buildDeckPrompt(input: UserInput, report: string): string {
  return `Company: ${input.companyName} | Country: ${input.country} | Sector: ${input.sector} | Engagement: ${input.engagementType}

Use the verified deep-research report below as your SOLE source of facts. Preserve the [N] citation markers next to facts you use.

--- VERIFIED RESEARCH REPORT ---
${report}
--- END RESEARCH REPORT ---

Based ONLY on the research above, write the full sell-side advisory pitch deck instructions for Gamma AI.

CRITICAL FORMATTING RULES:
- Use \\n---\\n ONLY as the slide separator between slides. Each --- creates a new slide.
- Do NOT use --- within a slide. Use headings, bold text, or blank lines for visual separation.
- textMode: preserve — content is used verbatim on each slide.

Tone: formal, data-driven, IFC institutional voice.

Slide structure (FOLLOW THIS ORDER EXACTLY):
1. Cover — client name, sector, "IFC Advisory Services — Sell-Side Advisory", date, confidential
2. Disclaimer — standard IFC advisory disclaimer
3. Agenda — table of contents
4. Executive Summary — synthesis: understanding of client needs, how IFC can support, track-record highlight, next steps. Structured bullets, not dense paragraphs.
5. Our Understanding of ${input.companyName} — deep narrative from Section 1 research: who they are, what they do, footprint, portfolio, strategic direction.
6. IFC Track Record & Capabilities — IFC/WBG overview + tombstone cards from research (name, country, year, one-liner). 6-8 cards.
7. Transaction Structure — TEMPLATE ONLY: left "Current Shareholders" ([Name] — [X]%), right "Proposed New Investors" ([Type] — [Target %]), center company logo placeholder, bottom note "Indicative structure — subject to due diligence and final terms." No narrative text.
8. Preliminary Views on Capital Raise & Potential Investors — (a) 4-6 investment highlights from research; (b) indicative investors by category (DFI, PE, Sovereign, Impact, Strategic) from Section 3 — name, country, 1-2 lines. Mark as indicative/non-binding.
9. Proposed Scope & Fees — scope (Preparation, Outreach, Negotiation & Closing); fees "To be discussed and agreed during mandate formalisation"; indicative 6-9 month timeline.
10. Next Steps — introductory meeting, mandate letter, data room, kick-off.
11. Contact Us — IFC advisory team + deal team placeholders.

For slides 5, 6, 8 use specific cited data from the research. For slides 7, 9 use the template structure with placeholders.`
}

async function streamTurn(
  messages: MessageParam[],
  step: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<{ text: string; costUSD: number }> {
  const stream = client.messages.stream({ model: MODEL, max_tokens: MAX_TOKENS, thinking: THINKING, system: SYSTEM, messages })
  let buffer = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      buffer += event.delta.text
      if (buffer.length >= 200) { await emit({ type: 'status', step, detail: `Orchestrator — ${buffer}` }); buffer = '' }
    }
  }
  if (buffer) await emit({ type: 'status', step, detail: `Orchestrator — ${buffer}` })
  const response = await stream.finalMessage()
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text block in Claude response')
  const costUSD = (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000
  return { text: textBlock.text, costUSD }
}

const MAX_ATTEMPTS = 2 // 1 real attempt + 1 retry, then abort

export async function runOrchestration(
  input: UserInput,
  fileContents: string[],
  emit: (e: ProgressEvent) => Promise<void>
): Promise<{ instructions: string; costUSD: number }> {
  const messages: MessageParam[] = []
  let totalCost = 0

  // ── Turn 1: Research brief ─────────────────────────────────────────────────
  await emit({ type: 'status', step: 'building_research_brief', detail: 'Orchestrator — Analysing inputs. Building Perplexity research brief...' })
  messages.push({ role: 'user', content: buildPhase1Prompt(input, fileContents) })
  const { text: brief, costUSD: briefCost } = await streamTurn(messages, 'building_research_brief', emit)
  messages.push({ role: 'assistant', content: brief })
  totalCost += briefCost
  await emit({ type: 'status', step: 'research_brief_ready', costUSD: totalCost })

  // ── Research loop (max 2 attempts), grounding gated ───────────────────────
  let research
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await emit({ type: 'status', step: 'retry', detail: `⚠ Retry ${attempt - 1}/${MAX_ATTEMPTS - 1} — previous attempt was not grounded in live web sources. Retrying once...` })
    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Starting deep research (attempt ${attempt}/${MAX_ATTEMPTS})...` })

    research = await attemptResearch(brief, emit)
    totalCost += research.costUSD
    await emit({ type: 'status', step: 'research_complete', detail: `Perplexity — [DIAGNOSTICS]\n${JSON.stringify({ attempt, sources: research.sourceCount, searches: research.numSearchQueries, grounded: research.grounded, reason: research.groundingReason ?? null, costUSD: Number(research.costUSD.toFixed(4)), citations: research.citations.map(c => ({ url: c.url, title: c.title })) }, null, 2)}`, costUSD: totalCost })

    if (research.grounded) break

    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`Perplexity is the bottleneck — research aborted. Across ${MAX_ATTEMPTS} consecutive deep-research attempts, Perplexity returned un-grounded results (${research.groundingReason}). It is NOT performing live web research and appears to be answering from training data. A sell-side pitch deck cannot be built on un-sourced content, so we are aborting rather than producing a deck with fabricated or unverifiable facts. This is a Perplexity-side failure, not a problem with your inputs — please retry in a few minutes.`)
    }
  }
  const result = research!

  // ── Citation spot-check (anti-hallucination) ──────────────────────────────
  const spot = await spotCheckCitations(result.report, result.citations, emit)
  const discrepancyReport = spot.verdicts.map(v => `[${v.n}] ${v.status} — ${v.url}\n     ${v.detail}`).join('\n')
  await emit({ type: 'status', step: 'spotcheck', detail: `Orchestrator — [Spot-Check Report]\nChecked ${spot.verdicts.length} random sources · ${spot.failCount} failed (fabricated/unsupported)\n\n${discrepancyReport}` })

  if (!spot.passed) {
    throw new Error(`Source verification FAILED — research aborted. ${spot.failCount} of ${spot.verdicts.length} spot-checked citations were fabricated (dead URL) or contradicted/misattributed (a readable source page disproves the claim or is about a different entity). Aborting to avoid shipping a deck built on fake sources. Review the discrepancies below to judge whether Perplexity hallucinated sources or the checker was too strict:\n\n${discrepancyReport}`)
  }

  // ── Turn 2: Deck instructions ──────────────────────────────────────────────
  await emit({ type: 'status', step: 'orchestrating', detail: 'Orchestrator — Sources verified. Building sell-side pitch deck instructions...' })
  messages.push({ role: 'user', content: buildDeckPrompt(input, result.report) })
  const { text: instructions, costUSD: deckCost } = await streamTurn(messages, 'orchestrating', emit)
  totalCost += deckCost
  await emit({ type: 'status', step: 'orchestrating', detail: `Orchestrator — Deck instructions complete. Cost: $${deckCost.toFixed(3)}` })

  return { instructions, costUSD: totalCost }
}
