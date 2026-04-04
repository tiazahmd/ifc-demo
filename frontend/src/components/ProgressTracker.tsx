import { useEffect, useRef, useState } from 'react'
import type { ProgressEvent } from '../../../shared/types'

interface ActivityEntry {
  time: string
  service: string
  message: string
  type: 'orchestrator' | 'perplexity' | 'gamma' | 'warn' | 'error'
}

interface Props {
  events: ProgressEvent[]
  companyName: string
  country: string
  sector: string
  onReset: () => void
}

const STEPS = [
  { key: 'inputs_received', label: 'Inputs received' },
  { key: 'research_brief_ready', label: 'Research brief prepared' },
  { key: 'research_complete', label: 'Deep research complete' },
  { key: 'orchestrating', label: 'Orchestrating deck content' },
  { key: 'done', label: 'Presentation generated' },
]

function stepIndex(step: string): number {
  const map: Record<string, number> = {
    inputs_received: 0, building_research_brief: 0,
    research_brief_ready: 1,
    researching: 2, retry: 2, research_complete: 2,
    orchestrating: 3,
    generating_deck: 4, done: 4,
  }
  return map[step] ?? -1
}

function toActivity(event: ProgressEvent): ActivityEntry | null {
  const now = new Date().toTimeString().slice(0, 8)
  const d = event.detail ?? ''
  if (!d) return null
  if (d.startsWith('Orchestrator')) return { time: now, service: 'Orchestrator', message: d.replace('Orchestrator — ', ''), type: 'orchestrator' }
  if (d.startsWith('Perplexity')) return { time: now, service: 'Perplexity', message: d.replace('Perplexity — ', ''), type: 'perplexity' }
  if (d.startsWith('Gamma')) return { time: now, service: 'Gamma', message: d.replace('Gamma — ', ''), type: 'gamma' }
  if (d.startsWith('Retry') || d.startsWith('⚠')) return { time: now, service: '⚠ Retry', message: d, type: 'warn' }
  return { time: now, service: 'System', message: d, type: 'orchestrator' }
}

const serviceColor: Record<string, string> = {
  orchestrator: 'text-sky-400',
  perplexity: 'text-indigo-400',
  gamma: 'text-purple-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
}

export function ProgressTracker({ events, companyName, country, sector, onReset }: Props) {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const activityRef = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  const latestEvent = events[events.length - 1]
  const isDone = latestEvent?.type === 'complete'
  const isError = latestEvent?.type === 'error'
  const currentStepIdx = events.length > 0 ? Math.max(...events.map(e => stepIndex(e.step))) : -1

  const totalCost = [...events].reverse().find(e => e.costUSD != null)?.costUSD ?? 0

  const sourceMatch = [...events].reverse().find(e => e.detail?.includes('sources'))?.detail?.match(/(\d+) sources/)
  const liveSourceCount = sourceMatch ? sourceMatch[1] : null

  useEffect(() => {
    if (isDone || isError) return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [isDone, isError])

  useEffect(() => {
    const last = events[events.length - 1]
    if (!last) return
    const entry = toActivity(last)
    if (!entry) return

    setActivity(a => {
      // If this is a polling update, replace the last polling entry instead of appending
      if (entry.message.startsWith('Researching...')) {
        const lastIdx = [...a].reverse().findIndex(e => e.message.startsWith('Researching...') || e.message.startsWith('Research job submitted'))
        if (lastIdx !== -1) {
          const idx = a.length - 1 - lastIdx
          const updated = [...a]
          updated[idx] = entry
          return updated
        }
      }
      return [...a, entry]
    })
  }, [events])

  useEffect(() => {
    if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight
  }, [activity])

  const completedSteps = isDone ? STEPS.length : currentStepIdx + 1
  const progress = Math.round((Math.max(0, completedSteps) / STEPS.length) * 100)
  const formatElapsed = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-[1100px]">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-navy rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">IFC</span>
            </div>
            <span className="text-sm font-medium text-gray-500">Pitch Deck Engine</span>
          </div>
          <h1 className="text-3xl font-semibold text-navy mb-1">
            {isDone ? 'Discussion Document Ready' : 'Generating Discussion Document'}
          </h1>
          <p className="text-gray-500">{companyName} · {country} · {sector} · Buy-Side Advisory</p>
        </div>

        <div className="grid grid-cols-[2fr_3fr] gap-6 items-start">
          {/* Left: Progress */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col gap-6 sticky top-8">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress</p>

            <div className="space-y-4">
              {STEPS.map((step, i) => {
                const done = isDone || i < currentStepIdx || (i === currentStepIdx && ['research_complete', 'done'].includes(latestEvent?.step))
                const active = !isDone && i === currentStepIdx
                const detail = [...events].reverse().find(e => stepIndex(e.step) === i)?.detail

                return (
                  <div key={step.key} className="flex items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0">
                      {done ? (
                        <span className="text-emerald-500 font-bold">✓</span>
                      ) : active ? (
                        <span className="inline-block w-4 h-4 border-2 border-sky border-t-transparent rounded-full spinner" />
                      ) : (
                        <span className="text-gray-300">○</span>
                      )}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${done ? 'text-gray-700' : active ? 'text-navy' : 'text-gray-400'}`}>
                        {step.label}
                        {i === 2 && liveSourceCount && (
                          <span className="ml-2 text-xs text-gray-400 font-normal">· {liveSourceCount} sources</span>
                        )}
                      </p>
                      {active && detail && !detail.includes('\n') && (
                        <p className="text-xs text-gray-400 mt-0.5">{detail}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Progress bar + stats */}
            <div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-sky rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between mt-2">
                <p className="text-xs text-gray-400">
                  {isDone ? 'Complete' : isError ? 'Failed' : `Step ${Math.min(Math.max(currentStepIdx + 1, 0), STEPS.length)} of ${STEPS.length}`}
                </p>
                <div className="flex gap-3">
                  {!isDone && !isError && elapsed > 0 && (
                    <p className="text-xs text-gray-400 font-mono">{formatElapsed(elapsed)}</p>
                  )}
                  {totalCost > 0 && (
                    <p className="text-xs text-gray-400 font-mono">${totalCost.toFixed(2)}</p>
                  )}
                </div>
              </div>
            </div>

            {isDone && latestEvent.downloadUrl && (
              <div className="space-y-2">
                {(totalCost > 0 || elapsed > 0) && (
                  <p className="text-xs text-center text-gray-400">
                    {totalCost > 0 ? `$${totalCost.toFixed(2)} · ` : ''}{formatElapsed(elapsed)}
                  </p>
                )}
                <a href={latestEvent.downloadUrl} download className="block w-full bg-navy text-white text-center py-2.5 rounded-lg text-sm font-medium hover:bg-navy/90 transition-colors">
                  ↓ Download PPTX
                </a>
                <button onClick={onReset} className="block w-full text-center py-2.5 rounded-lg text-sm font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors">
                  Start Over
                </button>
              </div>
            )}
            {isError && (
              <div className="space-y-2">
                <p className="text-sm text-red-500">{latestEvent.detail}</p>
                <button onClick={onReset} className="w-full text-center py-2.5 rounded-lg text-sm font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors">
                  Try Again
                </button>
              </div>
            )}
          </div>

          {/* Right: Live Activity */}
          <div className="bg-activity rounded-lg flex flex-col overflow-hidden" style={{ height: '70vh' }}>
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <p className="text-xs text-gray-500 font-mono ml-2">live-activity</p>
              </div>
              {totalCost > 0 && (
                <p className="text-xs font-mono text-gray-600">${totalCost.toFixed(2)}</p>
              )}
            </div>
            <div ref={activityRef} className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-xs scrollbar-thin">
              {activity.map((entry, i) => (
                <div key={i} className="flex gap-3 leading-relaxed">
                  <span className="text-gray-700 flex-shrink-0 select-none">{entry.time}</span>
                  <span className={`flex-shrink-0 font-semibold ${serviceColor[entry.type]}`}>{entry.service}</span>
                  <span className="text-gray-400 whitespace-pre-wrap break-words min-w-0">{entry.message}</span>
                </div>
              ))}
              {!isDone && !isError && (
                <div className="flex gap-3">
                  <span className="text-gray-700 select-none">{new Date().toTimeString().slice(0, 8)}</span>
                  <span className="text-gray-600 cursor-blink">▌</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
