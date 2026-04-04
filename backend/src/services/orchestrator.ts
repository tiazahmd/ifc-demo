import Anthropic from '@anthropic-ai/sdk'
import type { UserInput, Citation, ProgressEvent } from '../types.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const THINKING = { type: 'enabled' as const, budget_tokens: 8000 }

const PHASE1_SYSTEM = `You are an IFC advisory research coordinator. Your job is to generate a comprehensive, structured research brief for Perplexity's deep research model.

The brief must instruct Perplexity to research everything needed for a 12-slide IFC Buy-Side Advisory Discussion Document:
1. Company profile (history, ownership, leadership, operations)
2. Financial highlights (revenue, EBITDA, assets, debt, key ratios — last 3 years)
3. Industry & market context (market size, competitors, trends, regulatory environment)
4. Country & macro environment (GDP, investment climate, political stability, FX)
5. IFC track record in this sector/region (past transactions, strategic priorities)

Format the brief as clear, numbered research instructions. Specify which sources to prioritise (company IR pages, IFC.org, Bloomberg, Reuters, World Bank data).

If uploaded documents contain relevant data, extract and surface the key facts so Perplexity searches for corroborating and supplementary information — not what is already known.`

const PHASE2_SYSTEM = `You are an IFC pitch deck content architect. You receive a deep research report and produce structured markdown slide instructions for Gamma AI.

Rules:
- Use explicit --- between every slide (Gamma uses these as slide breaks)
- Use textMode: preserve — your content is used verbatim
- 12 slides total: Cover, Disclaimer, Table of Contents, Executive Summary, Company Overview, Financial Highlights, Industry & Market, Country & Macro, IFC Capabilities & Track Record, Proposed Engagement, Next Steps, Annex
- Charts: only include when data is available. Format: [Chart: <type> — <title>: <data>]
  - Revenue/financial trends → bar or line chart
  - Market share → donut chart
  - No data → text callout, no chart
- Tone: formal, data-driven, IFC institutional voice
- Include citation footnotes where relevant
- IFC boilerplate for Disclaimer, WBG overview, and Capabilities slides`

export async function buildResearchBrief(
  input: UserInput,
  fileContents: string[],
  emit: (e: ProgressEvent) => Promise<void>
): Promise<string> {
  const userMsg = [
    `Company: ${input.companyName}`,
    `Country: ${input.country}`,
    `Sector: ${input.sector}`,
    `Engagement Type: ${input.engagementType}`,
    input.companyWebsite ? `Website: ${input.companyWebsite}` : '',
    input.additionalLinks?.length ? `Additional links:\n${input.additionalLinks.join('\n')}` : '',
    input.additionalInstructions ? `Analyst instructions: ${input.additionalInstructions}` : '',
    fileContents.length ? `\n--- Uploaded Documents ---\n${fileContents.join('\n\n')}` : '',
  ].filter(Boolean).join('\n')

  await emit({ type: 'status', step: 'building_research_brief', detail: 'Orchestrator — Analysing inputs. Building Perplexity research brief...' })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    thinking: THINKING,
    system: PHASE1_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  })

  const text = response.content.find(b => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('No research brief generated')

  await emit({ type: 'status', step: 'building_research_brief', detail: `Orchestrator — Research brief complete.` })
  return text.text
}

export async function buildDeckInstructions(
  input: UserInput,
  report: string,
  citations: Citation[],
  emit: (e: ProgressEvent) => Promise<void>
): Promise<string> {
  await emit({ type: 'status', step: 'orchestrating', detail: 'Orchestrator — Building 12-slide deck instructions...' })

  const citationBlock = citations.slice(0, 20)
    .map((c, i) => `[${i + 1}] ${c.title ?? ''} — ${c.url}`)
    .join('\n')

  const userMsg = `Company: ${input.companyName} | Country: ${input.country} | Sector: ${input.sector}\n\n--- Research Report ---\n${report}\n\n--- Citations ---\n${citationBlock}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    thinking: THINKING,
    system: PHASE2_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  })

  const text = response.content.find(b => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('No deck instructions generated')

  await emit({ type: 'status', step: 'orchestrating', detail: 'Orchestrator — Deck instructions complete.' })
  return text.text
}
