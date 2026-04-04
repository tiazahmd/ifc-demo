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

      // Phase 1: Build Perplexity research brief
      await emit({ type: 'status', step: 'building_research_brief' })
      const brief = await buildResearchBrief(input, fileContents, emit)
      await emit({ type: 'status', step: 'research_brief_ready' })

      // Research with retry
      await emit({ type: 'status', step: 'researching', detail: 'Running deep research (2-5 min)...' })
      const { report, citations, sourceCount } = await runDeepResearch(brief, emit)
      await emit({ type: 'status', step: 'research_complete', detail: `${sourceCount} sources found` })

      // Phase 2: Build deck instructions
      await emit({ type: 'status', step: 'orchestrating' })
      const slideInstructions = await buildDeckInstructions(input, report, citations, emit)

      // Generate deck
      await emit({ type: 'status', step: 'generating_deck' })
      const downloadUrl = await generateDeck(slideInstructions, emit)

      await emit({ type: 'complete', step: 'done', downloadUrl })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await emit({ type: 'error', step: 'failed', detail: msg })
    }
  })
})
