'use client'

import { useRef, useState } from 'react'

/**
 * OfficeViewer — display Office documents in-app, OUT OF THE BOX (no LibreOffice install needed for viewing):
 *   • .docx → rendered with formatting via the vendored docx-preview
 *   • .xlsx/.xls/.csv → live sheets via the vendored SheetJS (xlsx)
 *   • .pptx / others → fall back to the LibreOffice convert path (/api/cap/office-convert)
 * All client-side (FileReader → ArrayBuffer), so it works fully offline + sovereign.
 */
type Kind = 'docx' | 'sheet' | 'other' | null

export function OfficeViewer() {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>(null)
  const [sheets, setSheets] = useState<Array<{ name: string; html: string }>>([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const docRef = useRef<HTMLDivElement | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setName(file.name); setError(''); setSheets([]); setKind(null); setBusy(true)
    const ext = (file.name.toLowerCase().split('.').pop() ?? '')
    try {
      const buf = await file.arrayBuffer()
      if (ext === 'docx') {
        setKind('docx')
        const { renderAsync } = await import('docx-preview')
        if (docRef.current) { docRef.current.innerHTML = ''; await renderAsync(buf, docRef.current, undefined, { className: 'docx', inWrapper: true }) }
      } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        setKind('sheet')
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: 'array' })
        setSheets(wb.SheetNames.map((n) => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n]!) })))
        setActive(0)
      } else {
        setKind('other')
      }
    } catch { setError('Could not render this file in-browser.') } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-primary)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border-secondary)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Documents</h1>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{name ? name : 'docs · sheets · slides — viewed locally'}</span>
        <label className="ml-auto cursor-pointer rounded-md bg-[var(--color-accent,#0891b2)] px-3 py-1 text-[11px] font-medium text-white">
          {busy ? 'Opening…' : 'Open file'}
          <input type="file" accept=".docx,.xlsx,.xls,.csv,.pptx,.ppt,.odt,.ods,.odp,.pdf" className="hidden" onChange={(e) => void onFile(e)} />
        </label>
      </header>
      {error && <div className="px-5 py-2 text-[11px] text-[#ef4444]">{error}</div>}
      <div className="flex-1 overflow-auto p-5">
        {!kind && <div className="flex h-full items-center justify-center text-center text-[var(--color-text-tertiary)]"><div><p className="text-xs">Open a .docx, .xlsx, or .csv to view it inline.</p><p className="mt-1 text-[10px]">.pptx and high-fidelity rendering use the optional LibreOffice toolkit.</p></div></div>}
        {kind === 'docx' && <div ref={docRef} className="mx-auto max-w-3xl rounded-lg bg-white p-6 text-black shadow" />}
        {kind === 'sheet' && (
          <div>
            <div className="mb-2 flex flex-wrap gap-1">
              {sheets.map((s, i) => (
                <button key={s.name} onClick={() => setActive(i)} className={`rounded px-2 py-0.5 text-[10px] ${i === active ? 'bg-[#16a34a]/15 text-[#16a34a]' : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'}`}>{s.name}</button>
              ))}
            </div>
            <div className="overflow-auto rounded-lg border border-[var(--color-border-secondary)] bg-white p-2 text-black [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs"
              dangerouslySetInnerHTML={{ __html: sheets[active]?.html ?? '' }} />
          </div>
        )}
        {kind === 'other' && (
          <div className="flex h-full items-center justify-center text-center text-[var(--color-text-tertiary)]">
            <div><p className="text-xs">This format needs the LibreOffice toolkit to render.</p><p className="mt-1 text-[10px]">Install LibreOffice (Capabilities → Office) to convert {name} for viewing.</p></div>
          </div>
        )}
      </div>
    </div>
  )
}
