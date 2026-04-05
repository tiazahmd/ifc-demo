import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { UserInputSchema } from '../schemas/input.js'
import { extractFileContents } from '../services/files.js'
import { buildResearchBrief, buildDeckInstructions } from '../services/orchestrator.js'
import { runDeepResearch } from '../services/research.js'
import { generateDeck } from '../services/deck.js'
import type { ProgressEvent } from '../types.js'

export const generateRoute = new Hono()

generateRoute.post('/', async (c) => {
  return streamSSE(c, async (stream) => {
    const emit = async (event: ProgressEvent) => {
      await stream.writeSSE({ data: JSON.stringify(event) })
    }

    // Keepalive: ping every 15s to prevent Render/proxy from killing the connection
    const keepalive = setInterval(async () => {
      await stream.writeSSE({ data: '{"type":"ping"}' })
    }, 15_000)

    try {
      // Parse multipart form
      const formData = await c.req.formData()
      const raw = Object.fromEntries(
        ['companyName','country','sector','engagementType','companyWebsite','additionalInstructions']
          .map(k => [k, formData.get(k) as string])
      )
      const linksRaw = formData.get('additionalLinks')
      const input = UserInputSchema.parse({
        ...raw,
        additionalLinks: linksRaw ? JSON.parse(linksRaw as string) : [],
      })

      await emit({ type: 'status', step: 'inputs_received' })

      // Extract uploaded file contents
      const files = formData.getAll('files') as File[]
      const fileContents = await extractFileContents(files)

      let totalCost = 0

      // Phase 1: Build Perplexity research brief
      await emit({ type: 'status', step: 'building_research_brief' })
      const { brief, costUSD: briefCost } = await buildResearchBrief(input, fileContents, emit)
      totalCost += briefCost
      await emit({ type: 'status', step: 'research_brief_ready', costUSD: totalCost })

      // Research with retry
      await emit({ type: 'status', step: 'researching', detail: 'Running deep research (2-5 min)...' })
      const { report, citations, sourceCount, costUSD: researchCost } = await runDeepResearch(brief, emit)
      totalCost += researchCost
      await emit({ type: 'status', step: 'research_complete', detail: `${sourceCount} sources found`, costUSD: totalCost })

      // Phase 2: Build deck instructions
      await emit({ type: 'status', step: 'orchestrating' })
      const { instructions: slideInstructions, costUSD: deckCost } = await buildDeckInstructions(input, report, citations, emit)
      totalCost += deckCost
      await emit({ type: 'status', step: 'orchestrating', costUSD: totalCost })

      // Generate deck
      await emit({ type: 'status', step: 'generating_deck' })
      const downloadUrl = await generateDeck(slideInstructions, emit)

      await emit({ type: 'complete', step: 'done', downloadUrl, costUSD: totalCost })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await emit({ type: 'error', step: 'failed', detail: msg })
    } finally {
      clearInterval(keepalive)
    }
  })
})
