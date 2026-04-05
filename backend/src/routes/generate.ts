import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { UserInputSchema } from '../schemas/input.js'
import { extractFileContents } from '../services/files.js'
import { runOrchestration } from '../services/orchestrator.js'
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
        ['companyName', 'country', 'sector', 'engagementType', 'companyWebsite', 'additionalInstructions']
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

      // Single orchestration call: brief → research loop → deck instructions
      const { instructions, costUSD } = await runOrchestration(input, fileContents, emit)

      // Generate deck
      await emit({ type: 'status', step: 'generating_deck' })
      const downloadUrl = await generateDeck(instructions, emit)

      await emit({ type: 'complete', step: 'done', downloadUrl, costUSD })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await emit({ type: 'error', step: 'failed', detail: msg })
    } finally {
      clearInterval(keepalive)
    }
  })
})
