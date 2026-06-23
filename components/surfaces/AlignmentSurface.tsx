'use client'

import { useState } from 'react'

/**
 * AlignmentSurface — "does what I just read align with my brain?" Paste a news article / claim; each sentence
 * is checked against your ingested documents + chat docs and labeled CORROBORATED / CONFLICTING / NOVEL with
 * the supporting/conflicting source. The demonstrable belief-alignment surface.
 */
type Claim = {
  claim: string
  verdict: 'corroborated' | 'conflicting' | 'novel'
  match?: { source?: string; text: string; relation: string; similarity: number }
}
type Report = {
  claims: Claim[]
  summary: { corroborated: number; conflicting: number; novel: number; total: number; alignmentScore: number }
  brainStatements: number
  matching: 'semantic' | 'lexical'
}

const VERDICT: Record<Claim['verdict'], { label: string; bar: string; chip: string; border: string }> = {
  corroborated: { label: 'Corroborated', bar: 'bg-[#16a34a]', chip: 'bg-[#dcfce7] text-[#16a34a]', border: 'border-l-[#16a34a]' },
  conflicting:  { label: 'Conflicting',  bar: 'bg-[#dc2626]', chip: 'bg-[#fef2f2] text-[#dc2626]', border: 'border-l-[#dc2626]' },
  novel:        { label: 'Novel',        bar: 'bg-[#2563eb]', chip: 'bg-[#eff6ff] text-[#2563eb]', border: 'border-l-[#2563eb]' },
}

const SAMPLE = 'Noetica is a local-first sovereign AI desktop. The graph store is called HellGraph. It runs entirely in the cloud and requires Google Workspace to function.'

export function AlignmentSurface() {
  const [text, setText] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function check() {
    if (!text.trim()) return
    setLoading(true); setErr(''); setReport(null)
    try {
      const r = await fetch('/api/cap/align-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      if (!r.ok) throw new Error(`align ${r.status}`)
      setReport(await r.json() as Report)
    } catch (e) { setErr(e instanceof Error ? e.message : 'alignment failed — is the backend running?') }
    finally { setLoading(false) }
  }

  const score = report?.summary.alignmentScore ?? 0
  const scoreColor = score > 0.2 ? '#16a34a' : score < -0.2 ? '#dc2626' : 'var(--color-text-secondary)'

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Alignment</div>
      <p className="mb-4 max-w-2xl text-xs text-[var(--color-text-secondary)]">Paste a news article or a set of claims. Each sentence is checked against your brain — ingested documents + chat docs — and labeled <span className="font-medium text-[#16a34a]">corroborated</span>, <span className="font-medium text-[#dc2626]">conflicting</span>, or <span className="font-medium text-[#2563eb]">novel</span>, with the source it agrees or conflicts with.</p>

      <textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Paste news / claims to check against your brain…"
        className="h-32 w-full resize-y rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8]"
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={check} disabled={loading || !text.trim()} className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">{loading ? 'Checking…' : 'Check alignment'}</button>
        <button onClick={() => setText(SAMPLE)} className="rounded-xl border border-[var(--color-border-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">Try a sample</button>
      </div>

      {err && <div className="mt-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{err}</div>}

      {report && (
        <div className="mt-5">
          {/* Summary */}
          <div className="mb-4 flex flex-wrap items-center gap-5 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
            <div><div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Alignment</div><div className="text-xl font-bold" style={{ color: scoreColor }}>{score > 0 ? '+' : ''}{score}</div></div>
            <div className="flex gap-3 text-xs">
              <span className="rounded-full bg-[#dcfce7] px-2 py-1 font-semibold text-[#16a34a]">{report.summary.corroborated} corroborated</span>
              <span className="rounded-full bg-[#fef2f2] px-2 py-1 font-semibold text-[#dc2626]">{report.summary.conflicting} conflicting</span>
              <span className="rounded-full bg-[#eff6ff] px-2 py-1 font-semibold text-[#2563eb]">{report.summary.novel} novel</span>
            </div>
            <div className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{report.matching} matching · {report.brainStatements} brain statements</div>
          </div>

          {/* Per-claim */}
          <div className="space-y-2">
            {report.claims.map((c, i) => {
              const v = VERDICT[c.verdict]
              return (
                <div key={i} className={`rounded-r-xl border-l-4 ${v.border} border-y border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-3 py-2`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${v.chip}`}>{v.label}</span>
                    <span className="text-xs text-[var(--color-text-primary)]">{c.claim}</span>
                  </div>
                  {c.match && (
                    <div className="mt-1 pl-[68px] text-[11px] text-[var(--color-text-tertiary)]">
                      {c.match.relation === 'contradict' ? 'contradicts' : 'agrees with'} <span className="font-medium text-[var(--color-text-secondary)]">{c.match.source ?? 'brain'}</span> ({c.match.similarity}): <span className="italic">“{c.match.text.slice(0, 90)}{c.match.text.length > 90 ? '…' : ''}”</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
