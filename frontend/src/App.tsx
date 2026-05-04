import { useState, useRef, useCallback } from 'react'
import { InputForm } from './components/InputForm'
import { ProgressTracker } from './components/ProgressTracker'
import type { ProgressEvent } from '../../shared/types'

export interface Artifact {
  name: string
  filename: string
  content: string
  ready: boolean
}

type AppState = 'form' | 'generating'
type ServerStatus = 'unknown' | 'checking' | 'ready' | 'cold'

export default function App() {
  const [state, setState] = useState<AppState>('form')
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [meta, setMeta] = useState({ companyName: '', country: '', sector: '' })
  const [serverStatus, setServerStatus] = useState<ServerStatus>('unknown')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])

  // Buffers for accumulating content across SSE chunks
  const researchBriefBuf = useRef('')
  const perplexityBuf = useRef('')
  const orchestratingBuf = useRef('')
  const lastStepRef = useRef('')
  const perplexityAttemptRef = useRef(0)

  const checkServer = async () => {
    setServerStatus('checking')
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/health`)
      if (res.ok) setServerStatus('ready')
      else setServerStatus('cold')
    } catch {
      setServerStatus('cold')
    }
  }

  const processArtifact = useCallback((event: ProgressEvent) => {
    const d = event.detail ?? ''

    // Research brief: step='building_research_brief', detail starts with 'Orchestrator —'
    if (event.step === 'building_research_brief' && d.startsWith('Orchestrator —')) {
      const text = d.replace('Orchestrator — ', '')
      // If this is a rewritten brief (retry), reset buffer to capture only the latest version
      if (text.startsWith('[Rewritten Brief')) {
        researchBriefBuf.current = text + '\n'
      } else {
        researchBriefBuf.current += text + '\n'
      }
    }

    // Finalize research brief when step transitions away
    if (lastStepRef.current === 'building_research_brief' && event.step !== 'building_research_brief' && researchBriefBuf.current) {
      setArtifacts(a => {
        const existing = a.find(x => x.filename === 'research-brief.md')
        if (existing) return a.map(x => x.filename === 'research-brief.md' ? { ...x, content: researchBriefBuf.current, ready: true } : x)
        return [...a, { name: 'Research Brief', filename: 'research-brief.md', content: researchBriefBuf.current, ready: true }]
      })
    }

    // Perplexity report chunks: detail starts with 'Perplexity — Research Report' or 'Perplexity — Report'
    if (d.startsWith('Perplexity — Research Report') || d.startsWith('Perplexity — Report')) {
      const text = d.replace(/^Perplexity — (Research )?Report[^:]*:\s*/, '')
      perplexityBuf.current += text + '\n'
    }

    // On retry: finalize current buffer as a numbered artifact, then reset for next attempt
    if (event.step === 'retry' && perplexityBuf.current) {
      const content = perplexityBuf.current
      perplexityAttemptRef.current++
      const n = perplexityAttemptRef.current
      setArtifacts(a => [...a, { name: `Perplexity Research (Attempt ${n})`, filename: `perplexity-research-${n}.md`, content, ready: true }])
      perplexityBuf.current = ''
    }

    // Finalize perplexity when step transitions from researching (final successful attempt)
    if (lastStepRef.current === 'researching' && event.step !== 'researching' && event.step !== 'retry' && perplexityBuf.current) {
      const content = perplexityBuf.current
      perplexityAttemptRef.current++
      const n = perplexityAttemptRef.current
      const isFinal = perplexityAttemptRef.current > 1
      setArtifacts(a => [...a, {
        name: isFinal ? `Perplexity Research (Attempt ${n} — Final)` : 'Perplexity Research',
        filename: isFinal ? `perplexity-research-${n}.md` : 'perplexity-research.md',
        content,
        ready: true,
      }])
    }

    // Deck instructions: step='orchestrating', detail starts with 'Orchestrator —'
    if (event.step === 'orchestrating' && d.startsWith('Orchestrator —')) {
      const text = d.replace('Orchestrator — ', '')
      orchestratingBuf.current += text + '\n'
    }

    // Finalize orchestrating when step transitions away
    if (lastStepRef.current === 'orchestrating' && event.step !== 'orchestrating' && orchestratingBuf.current) {
      setArtifacts(a => {
        const existing = a.find(x => x.filename === 'deck-instructions.md')
        if (existing) return a.map(x => x.filename === 'deck-instructions.md' ? { ...x, content: orchestratingBuf.current, ready: true } : x)
        return [...a, { name: 'Deck Instructions', filename: 'deck-instructions.md', content: orchestratingBuf.current, ready: true }]
      })
    }

    lastStepRef.current = event.step
  }, [])

  const handleSubmit = async (formData: FormData) => {
    setMeta({
      companyName: formData.get('companyName') as string,
      country: formData.get('country') as string,
      sector: formData.get('sector') as string,
    })
    setEvents([])
    setArtifacts([])
    researchBriefBuf.current = ''
    perplexityBuf.current = ''
    orchestratingBuf.current = ''
    lastStepRef.current = ''
    perplexityAttemptRef.current = 0
    setState('generating')

    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/generate`, { method: 'POST', body: formData })
    if (!res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6))
            if (event.type === 'ping') continue
            processArtifact(event)
            setEvents(e => [...e, event])
          } catch { /* skip malformed */ }
        }
      }
    }

    // Finalize any remaining buffers on stream end
    if (researchBriefBuf.current) {
      setArtifacts(a => a.find(x => x.filename === 'research-brief.md') ? a : [...a, { name: 'Research Brief', filename: 'research-brief.md', content: researchBriefBuf.current, ready: true }])
    }
    if (perplexityBuf.current) {
      const n = perplexityAttemptRef.current + 1
      setArtifacts(a => {
        const fname = n > 1 ? `perplexity-research-${n}.md` : 'perplexity-research.md'
        return a.find(x => x.filename === fname) ? a : [...a, {
          name: n > 1 ? `Perplexity Research (Attempt ${n} — Final)` : 'Perplexity Research',
          filename: fname, content: perplexityBuf.current, ready: true,
        }]
      })
    }
    if (orchestratingBuf.current) {
      setArtifacts(a => a.find(x => x.filename === 'deck-instructions.md') ? a : [...a, { name: 'Deck Instructions', filename: 'deck-instructions.md', content: orchestratingBuf.current, ready: true }])
    }
  }

  return state === 'form'
    ? <InputForm onSubmit={handleSubmit} serverStatus={serverStatus} onCheckServer={checkServer} />
    : <ProgressTracker
        events={events}
        companyName={meta.companyName}
        country={meta.country}
        sector={meta.sector}
        artifacts={artifacts}
        onReset={() => { setState('form'); setEvents([]); setServerStatus('unknown'); setArtifacts([]) }}
      />
}
