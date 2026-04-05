import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { UserInput, Citation, ProgressEvent } from '../types.js'
import { attemptResearch } from './research.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'
const THINKING = { type: 'enabled' as const, budget_tokens: 10000 }
const MAX_TOKENS = 32000  // well above thinking budget; supports long deck output

const SYSTEM = `You are an IFC advisory orchestrator managing a three-phase pipeline to produce a buy-side advisory pitch deck.

**Phase 1 — Research Brief**
When given company details and any uploaded documents, produce a focused, specific research brief (max 2000 words) for Perplexity deep research. Structure as numbered questions covering:
1. Company profile (history, ownership, leadership, operations, scale)
2. Financial highlights (revenue, EBITDA, assets, debt — last 3 years)
3. Industry & market (market size, competitors, trends, regulatory environment)
4. Country & macro (GDP, investment climate, political stability, FX)
5. IFC track record in this sector/region (past transactions, strategic priorities)
Prioritise sources: company IR pages, IFC.org, Bloomberg, Reuters, World Bank. Be specific and direct.

**Phase 2 — Research Evaluation**
When given a Perplexity research result, evaluate whether it constitutes sufficient research to produce a credible IFC pitch deck. Consider:
- Are there real cited sources? Zero sources almost always means a refusal or capability-limitation response.
- Is this substantive research or a disclaimer / knowledge-cutoff notice?
- Is there enough data to populate financial, sector, macro, and IFC slides?

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
When asked to write deck instructions, produce structured markdown for Gamma AI. Rules:
- 12 slides: Cover, Disclaimer, Table of Contents, Executive Summary, Company Overview, Financial Highlights, Industry & Market, Country & Macro, IFC Capabilities & Track Record, Proposed Engagement, Next Steps, Annex
- Use --- between every slide (Gamma slide breaks)
- textMode: preserve — your content is used verbatim
- Charts: [Chart: <type> — <title>: <data>] only when data is available. No data → text callout, no chart.
- Tone: formal, data-driven, IFC institutional voice
- Include citation footnotes where relevant
- IFC boilerplate for Disclaimer, WBG overview, and Capabilities slides`

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
  attempt: number
): string {
  const citationBlock = citations.slice(0, 30)
    .map((c, i) => `[${i + 1}] ${c.title ?? 'Source'} — ${c.url}`)
    .join('\n')

  return `Perplexity deep research returned the following (attempt ${attempt}/3). ${sourceCount} source(s) found.

--- RESEARCH REPORT ---
${report}

--- SOURCES ---
${citationBlock || 'No sources returned.'}
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

  // ── Research loop (up to 3 attempts) ───────────────────────────────────────
  let currentBrief = brief

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await emit({ type: 'status', step: 'retry', detail: `⚠ Retry ${attempt - 1}/3 — Rewriting research brief with new strategy...` })
    }

    await emit({ type: 'status', step: 'researching', detail: `Perplexity — Starting deep research (attempt ${attempt}/3). Takes 2-5 minutes...` })

    const { report, citations, sourceCount, costUSD: researchCost } = await attemptResearch(currentBrief, emit)
    totalCost += researchCost
    await emit({ type: 'status', step: 'research_complete', detail: `${sourceCount} sources found`, costUSD: totalCost })

    // Inject Perplexity result into the conversation thread
    messages.push({ role: 'user', content: buildEvaluationPrompt(report, citations, sourceCount, attempt) })

    // ── Turn 2: Evaluate ──────────────────────────────────────────────────────
    await emit({ type: 'status', step: 'evaluating_research', detail: `Orchestrator — Evaluating research quality (attempt ${attempt}/3)...` })

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
    if (attempt === 3) {
      throw new Error(`Research failed after 3 attempts. ${decision.reason}`)
    }
    currentBrief = decision.newBrief
  }

  // ── Turn 3: Deck instructions ───────────────────────────────────────────────
  await emit({ type: 'status', step: 'orchestrating', detail: 'Orchestrator — Building 12-slide deck instructions...' })

  messages.push({
    role: 'user',
    content: `Company: ${input.companyName} | Country: ${input.country} | Sector: ${input.sector} | Engagement: ${input.engagementType}\n\nBased on all research above, write the full 12-slide deck instructions for Gamma AI.`,
  })

  const { text: instructions, costUSD: deckCost } = await streamTurn(messages, 'orchestrating', emit)
  totalCost += deckCost
  await emit({ type: 'status', step: 'orchestrating', detail: `Orchestrator — Deck instructions complete. Cost: $${deckCost.toFixed(3)}` })

  return { instructions, costUSD: totalCost }
}
