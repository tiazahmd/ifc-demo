import { useState, useRef } from 'react'

interface Props {
  onSubmit: (formData: FormData) => void
  serverStatus: 'unknown' | 'checking' | 'ready' | 'cold'
  onCheckServer: () => void
}

export function InputForm({ onSubmit, serverStatus, onCheckServer }: Props) {
  const [links, setLinks] = useState<string[]>([])
  const [linkInput, setLinkInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const addLink = () => {
    if (linkInput.trim()) { setLinks(l => [...l, linkInput.trim()]); setLinkInput('') }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('additionalLinks', JSON.stringify(links))
    files.forEach(f => fd.append('files', f))
    onSubmit(fd)
  }

  return (
    <div className="min-h-screen flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-[640px]">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 bg-navy rounded-md flex items-center justify-center shadow-soft">
              <span className="text-white text-xs font-bold tracking-wide">IFC</span>
            </div>
            <span className="text-xs font-semibold text-fg-faint uppercase tracking-widest">Pitch Deck Engine</span>
          </div>
          <h1 className="text-3xl font-semibold text-navy tracking-tight mb-2">Generate a Pitch Deck</h1>
          <p className="text-fg-muted text-sm">AI-powered research and deck generation for IFC Advisory Services</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Company Details */}
          <div className="bg-elevated border border-border rounded-lg p-6 space-y-5 shadow-soft">
            <p className="text-[11px] font-semibold text-fg-faint uppercase tracking-[0.2em]">Company Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1.5">Company Name <span className="text-red-500">*</span></label>
                <input name="companyName" required className="w-full border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors" placeholder="e.g. Akij Group" />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1.5">Country <span className="text-red-500">*</span></label>
                <input name="country" required className="w-full border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors" placeholder="e.g. Bangladesh" />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1.5">Sector <span className="text-red-500">*</span></label>
                <input name="sector" required className="w-full border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors" placeholder="e.g. Cement" />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1.5">Engagement Type <span className="text-red-500">*</span></label>
                <select name="engagementType" defaultValue="sell-side-advisory" className="w-full border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors">
                  <option value="sell-side-advisory">Sell-Side Advisory</option>
                  <option value="buy-side-advisory">Buy-Side Advisory</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1.5">Company Website</label>
              <input name="companyWebsite" type="url" className="w-full border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors" placeholder="https://..." />
            </div>
          </div>

          {/* Supporting Materials */}
          <div className="bg-elevated border border-border rounded-lg p-6 space-y-4 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-fg-faint uppercase tracking-[0.2em]">Supporting Materials</p>
              <span className="text-[11px] text-fg-faint uppercase tracking-wider">Optional</span>
            </div>

            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-sky/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); setFiles(f => [...f, ...Array.from(e.dataTransfer.files)]) }}
            >
              <input ref={fileRef} type="file" multiple accept=".pdf,.docx" className="hidden" onChange={e => setFiles(f => [...f, ...Array.from(e.target.files ?? [])])} />
              <p className="text-sm text-fg-muted">Drop files here or <span className="text-sky font-medium">click to upload</span></p>
              <p className="text-xs text-fg-faint mt-1">PDF, DOCX · Max 10MB per file</p>
            </div>
            {files.length > 0 && (
              <div className="space-y-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-surface rounded-md px-3 py-2 border border-border">
                    <span className="text-fg truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="text-fg-faint hover:text-red-500 ml-2 transition-colors">✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLink())}
                className="flex-1 border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors"
                placeholder="Add a link (press Enter)"
              />
              <button type="button" onClick={addLink} className="px-4 py-2.5 text-sm font-medium text-sky border border-sky/30 rounded-md hover:bg-sky/5 transition-colors">Add</button>
            </div>
            {links.length > 0 && (
              <div className="space-y-1.5">
                {links.map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-surface rounded-md px-3 py-2 border border-border">
                    <span className="text-sky truncate">{l}</span>
                    <button type="button" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))} className="text-fg-faint hover:text-red-500 ml-2 transition-colors">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Additional Instructions */}
          <div className="bg-elevated border border-border rounded-lg p-6 space-y-3 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-fg-faint uppercase tracking-[0.2em]">Additional Instructions</p>
              <span className="text-[11px] text-fg-faint uppercase tracking-wider">Optional</span>
            </div>
            <textarea
              name="additionalInstructions"
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky/20 transition-colors resize-none"
              placeholder="e.g. Focus on ESG track record. Emphasise recent expansion into renewable energy..."
            />
          </div>

          {serverStatus !== 'ready' ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={onCheckServer}
                disabled={serverStatus === 'checking'}
                className="w-full border border-navy/20 text-navy py-3 rounded-lg font-semibold text-sm uppercase tracking-wider hover:bg-navy/5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {serverStatus === 'checking' ? (
                  <><span className="inline-block w-4 h-4 border-2 border-navy border-t-transparent rounded-full spinner" /> Checking server...</>
                ) : serverStatus === 'cold' ? (
                  '⚠ Server offline — Retry'
                ) : (
                  '⚡ Wake Server'
                )}
              </button>
              {serverStatus === 'unknown' && (
                <p className="text-xs text-center text-fg-faint">Start the server before generating to avoid delays</p>
              )}
              {serverStatus === 'cold' && (
                <p className="text-xs text-center text-red-400">Server did not respond. Try again in 30 seconds.</p>
              )}
            </div>
          ) : (
            <button
              type="submit"
              className="w-full bg-navy text-white py-3.5 rounded-lg font-semibold text-sm uppercase tracking-wider hover:translate-y-[-1px] hover:shadow-raised transition-all"
            >
              Generate Pitch Deck →
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
