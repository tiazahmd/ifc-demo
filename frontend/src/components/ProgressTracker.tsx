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
  { key: 'orchestrating', label: 'Orchestrating deck content' },  // maps to done after
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

  const latestEvent = events[events.length - 1]
  const isDone = latestEvent?.type === 'complete'
  const isError = latestEvent?.type === 'error'
  const currentStepIdx = Math.max(...events.map(e => stepIndex(e.step)))

  useEffect(() => {
    const last = events[events.length - 1]
    if (!last) return
    const entry = toActivity(last)
    if (entry) setActivity(a => [...a, entry])
  }, [events])

  useEffect(() => {
    if (activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight
    }
  }, [activity])

  const completedSteps = isDone ? STEPS.length : currentStepIdx + 1
  const progress = Math.round((completedSteps / STEPS.length) * 100)

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-[1100px]">
        {/* Header */}
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

        <div className="grid grid-cols-[2fr_3fr] gap-6">
          {/* Left: Progress */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col gap-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress</p>

            <div className="space-y-4">
              {STEPS.map((step, i) => {
                const done = isDone || i < currentStepIdx || (i === currentStepIdx && ['research_complete','done'].includes(latestEvent?.step))
                const active = !isDone && i === currentStepIdx
                const detail = events.findLast(e => stepIndex(e.step) === i)?.detail

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
                        {done && i === 2 && events.find(e => e.step === 'research_complete')?.detail && (
                          <span className="ml-2 text-xs text-gray-400 font-normal">
                            · {events.find(e => e.step === 'research_complete')?.detail}
                          </span>
                        )}
                      </p>
                      {active && detail && (
                        <p className="text-xs text-gray-400 mt-0.5">{detail}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {isDone ? 'Complete' : isError ? 'Failed' : `Step ${Math.min(currentStepIdx + 1, STEPS.length)} of ${STEPS.length}`}
              </p>
            </div>

            {/* Done / Error actions */}
            {isDone && latestEvent.downloadUrl && (
              <div className="space-y-2">
                <a
                  href={latestEvent.downloadUrl}
                  download
                  className="block w-full bg-navy text-white text-center py-2.5 rounded-lg text-sm font-medium hover:bg-navy/90 transition-colors"
                >
                  ↓ Download PPTX
                </a>
                <button
                  onClick={onReset}
                  className="block w-full text-center py-2.5 rounded-lg text-sm font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors"
                >
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
          <div className="bg-activity rounded-lg flex flex-col overflow-hidden" style={{ minHeight: '480px' }}>
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-mono">Live Activity</p>
            </div>
            <div ref={activityRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
              {activity.map((entry, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-gray-600 flex-shrink-0">{entry.time}</span>
                  <span className={`flex-shrink-0 font-medium ${serviceColor[entry.type]}`}>{entry.service}</span>
                  <span className="text-gray-300 leading-relaxed">{entry.message}</span>
                </div>
              ))}
              {!isDone && !isError && (
                <div className="flex gap-3">
                  <span className="text-gray-600">{new Date().toTimeString().slice(0, 8)}</span>
                  <span className="text-gray-500 cursor-blink">▌</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
