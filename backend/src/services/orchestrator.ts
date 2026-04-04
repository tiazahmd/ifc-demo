import Anthropic from '@anthropic-ai/sdk'
import type { UserInput, Citation, ProgressEvent } from '../types.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const THINKING = { type: 'enabled' as const, budget_tokens: 8000 }
const MAX_TOKENS_PHASE1 = 10000  // must exceed budget_tokens
const MAX_TOKENS_PHASE2 = 16000

const PHASE1_SYSTEM = `You are an IFC advisory research coordinator. Generate a CONCISE, focused research brief for Perplexity's deep research model. Maximum 2000 words.

The brief must be structured as clear numbered research questions covering:
1. Company profile (history, ownership, leadership, operations, size)
2. Financial highlights (revenue, EBITDA, assets, debt — last 3 years)
3. Industry & market (market size, competitors, trends, regulatory environment)
4. Country & macro (GDP, investment climate, political stability, FX)
5. IFC track record in this sector/region (past transactions, strategic priorities)

Format: numbered questions + bullet sub-points. Be specific and direct.
Prioritise sources: company IR pages, IFC.org, Bloomberg, Reuters, World Bank.

If uploaded documents contain data, extract key facts as context so Perplexity searches for corroborating information — not what is already known.

IMPORTANT: Keep the brief under 2000 words. Perplexity works best with focused, specific questions.`

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
    max_tokens: MAX_TOKENS_PHASE1,
    thinking: THINKING,
    system: PHASE1_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  })

  const text = response.content.find(b => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('No research brief generated')

  await emit({ type: 'status', step: 'building_research_brief', detail: 'Orchestrator — Brief complete.' })
  await emit({ type: 'status', step: 'building_research_brief', detail: `Orchestrator — Research Brief:\n${text.text}` })
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
    max_tokens: MAX_TOKENS_PHASE2,
    thinking: THINKING,
    system: PHASE2_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  })

  const text = response.content.find(b => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('No deck instructions generated')

  await emit({ type: 'status', step: 'orchestrating', detail: 'Orchestrator — Deck instructions complete.' })
  await emit({ type: 'status', step: 'orchestrating', detail: `Orchestrator — Deck Instructions:\n${text.text}` })
  return text.text
}
