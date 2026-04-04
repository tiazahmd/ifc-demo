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
    fd.set('engagementType', 'buy-side-advisory')
    files.forEach(f => fd.append('files', f))
    onSubmit(fd)
  }

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-[640px]">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-navy rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">IFC</span>
            </div>
            <span className="text-sm font-medium text-gray-500">Pitch Deck Engine</span>
          </div>
          <h1 className="text-3xl font-semibold text-navy mb-2">Generate a Discussion Document</h1>
          <p className="text-gray-500">Powered by AI research and IFC expertise</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Company Details */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Company Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
                <input name="companyName" required className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky focus:border-transparent" placeholder="e.g. Akij Group" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country <span className="text-red-500">*</span></label>
                <input name="country" required className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky focus:border-transparent" placeholder="e.g. Bangladesh" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sector <span className="text-red-500">*</span></label>
                <input name="sector" required className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky focus:border-transparent" placeholder="e.g. Cement" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Website</label>
                <input name="companyWebsite" type="url" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky focus:border-transparent" placeholder="https://..." />
              </div>
            </div>
          </div>

          {/* Supporting Materials */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Supporting Materials</p>
              <span className="text-xs text-gray-400">Optional</span>
            </div>

            {/* File upload */}
            <div
              className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-sky transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); setFiles(f => [...f, ...Array.from(e.dataTransfer.files)]) }}
            >
              <input ref={fileRef} type="file" multiple accept=".pdf,.docx" className="hidden" onChange={e => setFiles(f => [...f, ...Array.from(e.target.files ?? [])])} />
              <p className="text-sm text-gray-500">Drop files here or <span className="text-sky font-medium">click to upload</span></p>
              <p className="text-xs text-gray-400 mt-1">PDF, DOCX · Max 10MB per file</p>
            </div>
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                    <span className="text-gray-700 truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-2">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Links */}
            <div className="flex gap-2">
              <input
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLink())}
                className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky focus:border-transparent"
                placeholder="Add a link (press Enter)"
              />
              <button type="button" onClick={addLink} className="px-3 py-2 text-sm text-sky border border-sky rounded-md hover:bg-sky/5 transition-colors">Add</button>
            </div>
            {links.length > 0 && (
              <div className="space-y-1">
                {links.map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                    <span className="text-sky truncate">{l}</span>
                    <button type="button" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-2">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Additional Instructions */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Additional Instructions</p>
              <span className="text-xs text-gray-400">Optional</span>
            </div>
            <textarea
              name="additionalInstructions"
              rows={3}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky focus:border-transparent resize-none"
              placeholder="e.g. Focus on ESG track record. Emphasise recent expansion into renewable energy..."
            />
          </div>

          {serverStatus !== 'ready' ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={onCheckServer}
                disabled={serverStatus === 'checking'}
                className="w-full border border-navy text-navy py-3 rounded-lg font-medium text-sm hover:bg-navy/5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {serverStatus === 'checking' ? (
                  <><span className="inline-block w-4 h-4 border-2 border-navy border-t-transparent rounded-full spinner" /> Checking server...</>
                ) : serverStatus === 'cold' ? (
                  '⚠ Server offline — Retry Cold Start'
                ) : (
                  '⚡ Cold Start Server'
                )}
              </button>
              {serverStatus === 'unknown' && (
                <p className="text-xs text-center text-gray-400">Start the server before generating to avoid delays</p>
              )}
              {serverStatus === 'cold' && (
                <p className="text-xs text-center text-red-400">Server did not respond. Try again in 30 seconds.</p>
              )}
            </div>
          ) : (
            <button
              type="submit"
              className="w-full bg-navy text-white py-3 rounded-lg font-medium text-sm hover:bg-navy/90 transition-colors flex items-center justify-center gap-2"
            >
              Generate Pitch Deck →
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
