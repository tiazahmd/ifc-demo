import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { UserInput, Citation, ProgressEvent } from '../types.js'
import { attemptResearch } from './research.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'
const THINKING = { type: 'enabled' as const, budget_tokens: 10000 }
const MAX_TOKENS = 32000  // well above thinking budget; supports long deck output

const SYSTEM = `You are an IFC advisory orchestrator managing a three-phase pipeline to produce a sell-side advisory pitch deck.

The pitch deck's purpose is to convince a client to hire IFC as their advisor for raising capital (sell-side advisory). The deck must demonstrate that IFC understands the client, has relevant sector experience, and can connect them with the right investors.

**Phase 1 — Research Brief**
When given company details and any uploaded documents, produce a focused, specific research brief (max 1500 words) for Perplexity deep research. Structure as THREE sections:

**SECTION 1 — Company Intelligence**
Research the client company in depth. The goal is to build a comprehensive "Our Understanding of [Client]" narrative. Ask Perplexity to find:
- Corporate identity: legal name, founding year, headquarters, ownership structure, key shareholders
- Leadership: CEO/MD, board members, key executives
- Business model: what they do, what sector, what sub-sector specifically
- Geographic footprint: countries of operation, key markets
- Project portfolio: operational projects AND pipeline/development-stage projects (with capacity/scale, location, status where available)
- Strategic direction: what are they trying to achieve? Capital raise? Expansion? New markets?
- Recent news: press coverage, partnerships, awards, regulatory developments in last 2 years

If uploaded documents are provided, reference specific facts from them and ask Perplexity to verify, expand, and supplement with public sources. Do NOT just repeat the uploaded content — use it as a springboard for deeper research.

If a company website URL is provided, instruct Perplexity to crawl it thoroughly — especially "About", "Projects/Portfolio", "Team/Leadership", and "Investors/Partners" pages.

**SECTION 2 — IFC Track Record in [Sector]**
Search for IFC's investment and advisory track record in the client's sector and geographic markets. The output will populate a "tombstone" slide showing IFC's credibility. Ask Perplexity to:
- Search IFC's project disclosure page (disclosures.ifc.org) for projects in [sector] across [client's markets/regions]
- Also search "IFC [sector] [region]" on Google for press releases and project announcements
- For each project found, extract: project name, country, year, IFC commitment amount (USD), one-line description
- Target: 8-12 relevant projects
- Prioritize: same sub-sector, same geography, recent (last 5-7 years)

**SECTION 3 — Sector Investor Landscape**
Identify active investors in this sector who could be potential capital providers for the client. The output will populate an "Indicative Investors" slide. Ask Perplexity to:
- Categorize investors by type: Development Finance Institutions (DFIs), Private Equity funds, Sovereign Wealth Funds, Impact Investors, Strategic Corporates
- For each investor: name, country of incorporation, approximate AUM or fund size, 1-2 line description of their activity in this sector
- Target: 15-20 investors across categories
- Scope to investors active in [client's geographic markets] and [sector]
- If a capital raise amount is known or can be inferred from uploaded documents, note the deal size range to help scope investor relevance

**Brief Style Rules:**
- Be direct and specific — write questions a journalist would ask, not an academic essay
- Name specific sources to search (IFC disclosure page, company website URL, sector databases)
- If the user provided a company website, include the URL explicitly and instruct Perplexity to crawl it
- Do NOT ask for macro/country data — this is a pitch deck about hiring IFC, not a country report
- Do NOT ask for detailed financial statements — if the client shared financials in uploaded docs, reference those; otherwise skip
- Keep total brief under 1500 words — Perplexity performs better with focused briefs

**Phase 2 — Research Evaluation**
When given a Perplexity research result, evaluate whether it constitutes sufficient research to produce a credible IFC sell-side pitch deck.

IMPORTANT — Source metadata context:
Perplexity's sonar-deep-research has a known intermittent bug where web searches execute successfully but the citations/search_results arrays are returned empty. The pipeline pre-filters these failures and auto-retries, so you should rarely see zero-source results. However, if you do, or if the source count seems low relative to the content depth, evaluate the CONTENT INDEPENDENTLY of the source count. Specifically:

1. Does the report contain specific, verifiable data points (named companies, dollar figures, dates, percentages, named sources inline)?
2. Does it contain inline citation markers like [1], [Source Name, Year], or named references?
3. Does it read like genuine research (specific, falsifiable claims) or like LLM padding (hedged estimates, "approximately," "believed to be," "would require verification")?
4. Is there enough data to populate: "Our Understanding of Client" slide, IFC tombstone cards, indicative investor list, and investment highlights?

A report with 0 formal source metadata but rich inline citations and specific data points is USABLE — flag the metadata gap but PROCEED.
A report with 50 sources but only hedged generalities is NOT usable — RETRY.

Write your assessment, then end your response with exactly one fenced JSON block (no other fenced JSON elsewhere in your response):

\`\`\`json
{"action":"PROCEED"}
\`\`\`
or
\`\`\`json
{"action":"RETRY","reason":"<why this result is insufficient>","newBrief":"<full rewritten brief — materially different angle from the previous attempt>"}
\`\`\`
or
\`\`\`json
{"action":"ABORT","message":"<clear user-facing message explaining why research cannot proceed>"}
\`\`\`

**Phase 3 — Deck Instructions**
When asked to write deck instructions, produce structured markdown for Gamma AI. This phase will be specified in the deck generation prompt. Follow whatever slide structure is provided there.`

type Decision =
  | { action: 'PROCEED' }
  | { action: 'RETRY'; reason: string; newBrief: string }
  | { action: 'ABORT'; message: string }

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

function buildEvaluationPrompt(
  report: string,
  citations: Citation[],
  sourceCount: number,
  numSearchQueries: number,
  attempt: number,
  maxAttempts: number
): string {
  const citationBlock = citations.slice(0, 30)
    .map((c, i) => `[${i + 1}] ${c.title ?? 'Source'} — ${c.url}`)
    .join('\n')

  const metadataNote = sourceCount === 0 && numSearchQueries > 0
    ? `\n⚠️ NOTE: Perplexity executed ${numSearchQueries} web searches but returned 0 source metadata (known intermittent platform bug). Evaluate the CONTENT on its own merits — look for inline citations, specific data points, and verifiable claims.\n`
    : ''

  return `Perplexity deep research returned the following (attempt ${attempt}/${maxAttempts}). ${sourceCount} source(s) found. ${numSearchQueries} web searches executed.
${metadataNote}
--- RESEARCH REPORT ---
${report}

--- SOURCES ---
${citationBlock || 'No source metadata returned (see note above).'}
---

Evaluate this result and end your response with the required JSON decision block.`
}

function parseDecision(text: string): Decision {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (!match) throw new Error('Orchestrator evaluation did not return a valid JSON decision block')
  return JSON.parse(match[1]) as Decision
}

async function streamTurn(
  messages: MessageParam[],
  step: string,
  emit: (e: ProgressEvent) => Promise<void>
): Promise<{ text: string; costUSD: number }> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: THINKING,
    system: SYSTEM,
    messages,
  })

  let buffer = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      buffer += event.delta.text
      if (buffer.length >= 200) {
        await emit({ type: 'status', step, detail: `Orchestrator — ${buffer}` })
        buffer = ''
      }
    }
  }
  if (buffer) await emit({ type: 'status', step, detail: `Orchestrator — ${buffer}` })

  const response = await stream.finalMessage()
  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text block in Claude response')

  const costUSD = (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000
  return { text: textBlock.text, costUSD }
}

export async function runOrchestration(
  input: UserInput,
  fileContents: string[],
  emit: (e: ProgressEvent) => Promise<void>
): Promise<{ instructions: string; costUSD: number }> {
  const messages: MessageParam[] = []
  let totalCost = 0

  // ── Turn 1: Research brief ──────────────────────────────────────────────────
  await emit({ type: 'status', step: 'building_research_brief', detail: 'Orchestrator — Analysing inputs. Building Perplexity research brief...' })
  messages.push({ role: 'user', content: buildPhase1Prompt(input, fileContents) })

  const { text: brief, costUSD: briefCost } = await streamTurn(messages, 'building_research_brief', emit)
  messages.push({ role: 'assistant', content: brief })
  totalCost += briefCost
  await emit({ type: 'status', step: 'research_brief_ready', costUSD: totalCost })

  // ── Research loop (up to 5 attempts) ───────────────────────────────────────
  // Fast-retry: if Perplexity returns 0 sources (known intermittent bug),
  // retry immediately without burning a Claude evaluation turn.
  const MAX_ATTEMPTS = 5
  let currentBrief = brief
  let fastRetries = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await emit({ type: 'status', step: 'retry', detail: `⚠ Retry ${attempt - 1}/${MAX_ATTEMPTS} — ${fastRetries > 0 ? 'Fast-retry (zero sources detected)' : 'Rewriting research brief with new strategy'}...` })
    }

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Starting deep research (attempt ${attempt}/${MAX_ATTEMPTS}). Takes 2-5 minutes...` })

    const { report, citations, sourceCount, numSearchQueries, costUSD: researchCost } = await attemptResearch(currentBrief, emit)
    totalCost += researchCost
    await emit({ type: 'status', step: 'research_complete', detail: `${sourceCount} sources found (${numSearchQueries} searches executed)`, costUSD: totalCost })

    // ── Fast-retry: skip Claude evaluation if zero sources (known Perplexity bug) ──
    if (sourceCount === 0 && attempt < MAX_ATTEMPTS) {
      fastRetries++
      await emit({ type: 'status', step: 'researching', detail:
        `⚠ Zero sources returned — known Perplexity intermittent bug. Fast-retrying without Claude evaluation (saves ~$0.05). Attempt ${attempt}/${MAX_ATTEMPTS}.`
      })
      // Don't add to messages — no point evaluating empty research
      continue
    }

    // Inject Perplexity result into the conversation thread
    messages.push({ role: 'user', content: buildEvaluationPrompt(report, citations, sourceCount, numSearchQueries, attempt, MAX_ATTEMPTS) })

    // ── Turn 2: Evaluate ──────────────────────────────────────────────────────
    await emit({ type: 'status', step: 'evaluating_research', detail: `Orchestrator — Evaluating research quality (attempt ${attempt}/${MAX_ATTEMPTS})...` })

    const { text: evalText, costUSD: evalCost } = await streamTurn(messages, 'evaluating_research', emit)
    messages.push({ role: 'assistant', content: evalText })
    totalCost += evalCost
    await emit({ type: 'status', step: 'evaluating_research', costUSD: totalCost })

    const decision = parseDecision(evalText)

    if (decision.action === 'PROCEED') break

    if (decision.action === 'ABORT') {
      throw new Error(decision.message)
    }

    // RETRY — use Claude's rewritten brief for the next Perplexity call
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`Research failed after ${MAX_ATTEMPTS} attempts. ${decision.reason}`)
    }
    currentBrief = decision.newBrief
    // Emit the rewritten brief so the frontend can capture it as a downloadable artifact
    await emit({ type: 'status', step: 'building_research_brief', detail: `Orchestrator — [Rewritten Brief — Attempt ${attempt + 1}]\n\n${decision.newBrief}` })
  }

  // ── Turn 3: Deck instructions ───────────────────────────────────────────────
  await emit({ type: 'status', step: 'orchestrating', detail: 'Orchestrator — Building sell-side pitch deck instructions...' })

  messages.push({
    role: 'user',
    content: `Company: ${input.companyName} | Country: ${input.country} | Sector: ${input.sector} | Engagement: ${input.engagementType}

Based on all research above, write the full sell-side advisory pitch deck instructions for Gamma AI.

Use --- between every slide (Gamma slide breaks). textMode: preserve — your content is used verbatim.
Tone: formal, data-driven, IFC institutional voice. Include citation footnotes where relevant.

Slide structure:
1. Cover — client name, sector, "IFC Advisory Services — Sell-Side Advisory", date, confidential
2. Disclaimer — standard IFC advisory disclaimer (generate appropriate legal language)
3. Table of Contents — list all sections
4. Why IFC — generic IFC/World Bank Group overview, global reach, capabilities (IFC content)
5. IFC Capabilities in [Region] — regional presence, staff, offices (IFC content)
6. IFC Track Record in [Sector] — tombstone cards from research: project name, country, year, one-liner. Target 6-8 cards in a grid layout.
7. Our Understanding of [Client] — the KEY custom slide. Deep narrative from Section 1 research: who they are, what they do, where they operate, project portfolio, strategic direction. This is the slide that shows IFC has done its homework.
8. Transaction Structure — template showing current investors/shareholders on left, space for new investors on right. Generic sell-side capital raise structure.
9. Investment Highlights — 4-6 compelling bullet points about why investors should be interested in this client. Synthesize from research. Should sound specific but draw on sector-standard language.
10. Indicative Investors — active investors in this sector by category (DFI, PE, Sovereign, Impact, Strategic). From Section 3 research. For each: name, country, 1-2 line description. Note: names shown, but presented as indicative/non-binding.
11. Scope of Work — standard sell-side advisory phases: Preparation (due diligence, materials), Outreach (investor contact, data room), Negotiation & Closing. Generic IFC content.
12. Fee Structure — BLANK template. Note: "To be discussed and agreed during mandate formalisation."
13. Timeline — indicative sell-side process timeline (6-9 months typical). Generic Gantt-style phases.
14. Next Steps — standard: introductory meeting, mandate letter, data room, kick-off.
15. Annex: Deal Team — placeholder for team bios.
16. Executive Summary — WRITE THIS LAST. Summarize: our understanding of client needs, how IFC can support, IFC track record highlight, proposed next steps. This is the synthesis slide.

For slides marked "IFC content", generate appropriate institutional language. The analyst will refine.
For research-driven slides (6, 7, 9, 10), use specific data from the Perplexity research.
For template slides (8, 12, 13, 15), provide the structure with placeholder content where needed.`,
  })

  const { text: instructions, costUSD: deckCost } = await streamTurn(messages, 'orchestrating', emit)
  totalCost += deckCost
  await emit({ type: 'status', step: 'orchestrating', detail: `Orchestrator — Deck instructions complete. Cost: $${deckCost.toFixed(3)}` })

  return { instructions, costUSD: totalCost }
}
