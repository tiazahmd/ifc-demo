import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { generateRoute } from './routes/generate.js'

const app = new Hono()

app.use('*', cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  allowMethods: ['GET', 'POST'],
}))

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/generate', generateRoute)

const port = Number(process.env.PORT ?? 3001)
console.log(`Backend running on port ${port}`)

serve({ fetch: app.fetch, port })
