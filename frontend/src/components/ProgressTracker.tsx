import { useEffect, useRef, useState, useCallback } from 'react'
import type { ProgressEvent } from '../../../shared/types'
import type { Artifact } from '../App'

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
  artifacts: Artifact[]
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
    researching: 2, retry: 2, research_complete: 2, evaluating_research: 2, spotcheck: 2,
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
  orchestrator: 'text-sky',
  perplexity: 'text-indigo-500',
  gamma: 'text-purple-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
}

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ProgressTracker({ events, companyName, country, sector, artifacts, onReset }: Props) {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const activityRef = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  const [stalled, setStalled] = useState(false)
  const lastEventTimeRef = useRef(Date.now())
  const [downloadsOpen, setDownloadsOpen] = useState(true)

  // Scroll persistence
  const isNearBottomRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const handleScroll = useCallback(() => {
    const el = activityRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    isNearBottomRef.current = nearBottom
    setShowScrollBtn(!nearBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    if (activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight
      isNearBottomRef.current = true
      setShowScrollBtn(false)
    }
  }, [])

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

  // Stall watchdog: warn if no SSE events arrive for 90s
  useEffect(() => { lastEventTimeRef.current = Date.now(); setStalled(false) }, [events.length])
  useEffect(() => {
    if (isDone || isError) return
    const t = setInterval(() => { if (Date.now() - lastEventTimeRef.current > 90_000) setStalled(true) }, 5_000)
    return () => clearInterval(t)
  }, [isDone, isError])

  const lastIndexRef = useRef(0)
  useEffect(() => {
    const newEvents = events.slice(lastIndexRef.current)
    lastIndexRef.current = events.length
    const newEntries = newEvents.map(toActivity).filter((e): e is ActivityEntry => e !== null)
    if (!newEntries.length) return

    setActivity((prev: ActivityEntry[]) => {
      let updated = [...prev]
      for (const entry of newEntries) {
        if (entry.message.startsWith('Researching...')) {
          const lastIdx = [...updated].reverse().findIndex(e => e.message.startsWith('Researching...') || e.message.startsWith('Research job submitted'))
          if (lastIdx !== -1) {
            updated[updated.length - 1 - lastIdx] = entry
            continue
          }
        }
        updated = [...updated, entry]
      }
      return updated
    })
  }, [events])

  // Auto-scroll only if near bottom
  useEffect(() => {
    if (isNearBottomRef.current && activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight
    }
  }, [activity])

  const completedSteps = isDone ? STEPS.length : currentStepIdx + 1
  const progress = Math.round((Math.max(0, completedSteps) / STEPS.length) * 100)
  const formatElapsed = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`

  const readyArtifacts = artifacts.filter(a => a.ready)

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-[1100px]">
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 bg-navy rounded-md flex items-center justify-center shadow-soft">
              <span className="text-white text-xs font-bold tracking-wide">IFC</span>
            </div>
            <span className="text-xs font-semibold text-fg-faint uppercase tracking-[0.2em]">Pitch Deck Engine</span>
          </div>
          <h1 className="text-3xl font-semibold text-navy tracking-tight mb-1">
            {isDone ? 'Discussion Document Ready' : 'Generating Discussion Document'}
          </h1>
          <p className="text-fg-muted text-sm">{companyName} · {country} · {sector}</p>
        </div>

        <div className="grid grid-cols-[2fr_3fr] gap-6 items-start">
          {/* Left: Progress + Downloads */}
          <div className="space-y-4">
            <div className="bg-elevated border border-border rounded-lg p-6 flex flex-col gap-6 sticky top-8 shadow-soft">
              <p className="text-[11px] font-semibold text-fg-faint uppercase tracking-[0.2em]">Progress</p>

              <div className="space-y-4">
                {STEPS.map((step, i) => {
                  const done = isDone || i < currentStepIdx || (i === currentStepIdx && ['research_complete', 'done'].includes(latestEvent?.step))
                  const active = !isDone && i === currentStepIdx
                  const detail = [...events].reverse().find(e => stepIndex(e.step) === i)?.detail

                  return (
                    <div key={step.key} className="flex items-start gap-3">
                      <div className="mt-0.5 flex-shrink-0">
                        {done ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent text-xs font-bold">✓</span>
                        ) : active ? (
                          <span className="inline-block w-5 h-5 border-2 border-sky border-t-transparent rounded-full spinner" />
                        ) : (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-border text-fg-faint text-xs">○</span>
                        )}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${done ? 'text-fg' : active ? 'text-navy' : 'text-fg-faint'}`}>
                          {step.label}
                          {i === 2 && liveSourceCount && (
                            <span className="ml-2 text-xs text-fg-faint font-normal">· {liveSourceCount} sources</span>
                          )}
                        </p>
                        {active && detail && !detail.includes('\n') && (
                          <p className="text-xs text-fg-faint mt-0.5 truncate max-w-[200px]">{detail}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Progress bar */}
              <div>
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-sky rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between mt-2">
                  <p className="text-xs text-fg-faint">
                    {isDone ? 'Complete' : isError ? 'Failed' : `Step ${Math.min(Math.max(currentStepIdx + 1, 0), STEPS.length)} of ${STEPS.length}`}
                  </p>
                  <div className="flex gap-3">
                    {!isDone && !isError && elapsed > 0 && (
                      <p className="text-xs text-fg-faint font-mono">{formatElapsed(elapsed)}</p>
                    )}
                  </div>
                </div>
              </div>

              {stalled && !isDone && !isError && (
                <p className="text-xs text-amber-500 bg-amber-500/10 rounded-md px-3 py-2">
                  No updates for 90s+ — the connection may have stalled. Deep research can be slow, but if this persists the stream may have dropped. Check back or restart.
                </p>
              )}

              {isDone && latestEvent.downloadUrl && (
                <div className="space-y-2">
                  {elapsed > 0 && (
                    <p className="text-xs text-center text-fg-faint">
                      {formatElapsed(elapsed)}
                    </p>
                  )}
                  <a href={latestEvent.downloadUrl} download className="block w-full bg-navy text-white text-center py-3 rounded-lg text-sm font-semibold uppercase tracking-wider hover:translate-y-[-1px] hover:shadow-raised transition-all">
                    ↓ Download PPTX
                  </a>
                  <button onClick={onReset} className="block w-full text-center py-2.5 rounded-lg text-sm font-medium text-fg-muted border border-border hover:bg-surface transition-colors">
                    Start Over
                  </button>
                </div>
              )}
              {isError && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wider">Aborted</p>
                  <p className="text-sm text-red-500 whitespace-pre-wrap break-words max-h-72 overflow-y-auto scrollbar-thin">{latestEvent.detail}</p>
                  <button onClick={onReset} className="w-full text-center py-2.5 rounded-lg text-sm font-medium text-fg-muted border border-border hover:bg-surface transition-colors">
                    Try Again
                  </button>
                </div>
              )}
            </div>

            {/* Downloads Panel */}
            {readyArtifacts.length > 0 && (
              <div className="bg-elevated border border-border rounded-lg shadow-soft overflow-hidden fade-in">
                <button
                  onClick={() => setDownloadsOpen(o => !o)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-surface/50 transition-colors"
                >
                  <p className="text-[11px] font-semibold text-fg-faint uppercase tracking-[0.2em]">
                    Downloads ({readyArtifacts.length})
                  </p>
                  <span className={`text-fg-faint text-xs transition-transform ${downloadsOpen ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {downloadsOpen && (
                  <div className="px-6 pb-4 space-y-2">
                    {readyArtifacts.map((artifact) => (
                      <button
                        key={artifact.filename}
                        onClick={() => downloadBlob(artifact.content, artifact.filename)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-md border border-border hover:border-sky/30 hover:bg-sky/5 transition-colors text-left fade-in"
                      >
                        <div>
                          <p className="text-sm font-medium text-fg">{artifact.name}</p>
                          <p className="text-xs text-fg-faint">{artifact.filename}</p>
                        </div>
                        <span className="text-sky text-sm">↓</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Live Activity */}
          <div className="bg-elevated border border-border rounded-lg flex flex-col overflow-hidden shadow-soft relative" style={{ height: '70vh' }}>
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-surface/50">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
                </div>
                <p className="text-[11px] text-fg-faint font-mono ml-2 uppercase tracking-wider">live-activity</p>
              </div>
              {/* Cost hidden from external viewers */}
            </div>
            <div
              ref={activityRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-xs scrollbar-thin"
            >
              {activity.map((entry, i) => (
                <div key={i} className="flex gap-3 leading-relaxed">
                  <span className="text-fg-faint/50 flex-shrink-0 select-none">{entry.time}</span>
                  <span className={`flex-shrink-0 font-semibold ${serviceColor[entry.type]}`}>{entry.service}</span>
                  <span className="text-fg-muted whitespace-pre-wrap break-words min-w-0">{entry.message}</span>
                </div>
              ))}
              {!isDone && !isError && (
                <div className="flex gap-3">
                  <span className="text-fg-faint/50 select-none">{new Date().toTimeString().slice(0, 8)}</span>
                  <span className="text-fg-faint cursor-blink">▌</span>
                </div>
              )}
            </div>

            {/* Scroll to bottom button */}
            {showScrollBtn && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-4 right-4 w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center shadow-raised hover:translate-y-[-1px] transition-all text-xs"
                aria-label="Scroll to bottom"
              >
                ↓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
