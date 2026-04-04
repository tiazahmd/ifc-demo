import { useState } from 'react'
import { InputForm } from './components/InputForm'
import { ProgressTracker } from './components/ProgressTracker'
import type { ProgressEvent } from '../../shared/types'

type AppState = 'form' | 'generating'

export default function App() {
  const [state, setState] = useState<AppState>('form')
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [meta, setMeta] = useState({ companyName: '', country: '', sector: '' })

  const handleSubmit = async (formData: FormData) => {
    setMeta({
      companyName: formData.get('companyName') as string,
      country: formData.get('country') as string,
      sector: formData.get('sector') as string,
    })
    setEvents([])
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
            setEvents(e => [...e, event])
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  return state === 'form'
    ? <InputForm onSubmit={handleSubmit} />
    : <ProgressTracker
        events={events}
        companyName={meta.companyName}
        country={meta.country}
        sector={meta.sector}
        onReset={() => { setState('form'); setEvents([]) }}
      />
}
