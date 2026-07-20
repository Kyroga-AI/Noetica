'use client'

import { useCallback, useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'
import { AudioOverviewPlayer } from '@/components/chat/AudioOverviewPlayer'

// Academy — the door to the Alexandrian education moat. Anthropic (a Socratic AI tutor) meets
// OpenCourseWare (the verified canon) meets homeschool (a mastery path + spaced practice) — all local,
// so a learner's data never leaves the device. Tufte: the prerequisite path IS the graphic; level is a
// quiet marginal label; no gamification chartjunk. Wired to the real backend (/api/learn/path,
// /api/learning/srs/*). v1 = Learn (path) + Practice (flashcards).

type Tab = 'learn' | 'practice' | 'lecture' | 'reference' | 'progress'
interface PathNode { id: string; name: string; level: string; subject: string; prereq: string[] }
interface LearningPath { goal: string; resolved: string; path: PathNode[]; levels: string[] }
interface DueCard { id: string; task: string; abstraction?: string; steps?: string[] }
interface CanonResult { route?: { entities?: string[]; genus?: string[]; equations?: Array<{ name: string; form: string }> }; lookup?: string | null }
interface Progress { brief?: string; artifact?: { lens: string; text: string } | null }

const LEVEL_META: Record<string, { label: string; dot: string }> = {
  k12:      { label: 'Foundation', dot: 'var(--color-text-tertiary)' },
  undergrad:{ label: 'Undergrad',  dot: 'var(--color-accent)' },
  grad:     { label: 'Graduate',   dot: 'var(--color-attention)' },
}

function ask(prompt: string) { window.dispatchEvent(new CustomEvent('noetica:ask', { detail: prompt })) }
function downloadJson(obj: unknown, filename: string) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = href; a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href)
}

// Lecture — a spoken, two-voice overview of the learner's material, with call-in (reuses the proven
// AudioOverviewPlayer). Generated on-device. The NotebookLM-style "listen to it" mode.
function LectureTab() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <p className="mb-3 text-[13px] leading-relaxed text-[var(--color-text-tertiary)]">
        A spoken lecture on your material — two voices, hands-free. Play it, or call in to ask a question
        mid-lecture. Generated on-device from what you’ve added.
      </p>
      <AudioOverviewPlayer />
    </div>
  )
}

export function AcademySurface() {
  const [tab, setTab] = useState<Tab>('learn')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--color-border-secondary)] px-6 py-4">
        <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Academy</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-text-tertiary)]">
          Learn anything — from K-12 foundations to the graduate canon — with a private AI tutor. Your
          learning never leaves this device.
        </p>
        <div className="mt-3 flex gap-1">
          {(['learn', 'practice', 'lecture', 'reference', 'progress'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1 text-[12.5px] font-medium capitalize transition ${
                tab === t ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'learn' ? <LearnTab /> : tab === 'practice' ? <PracticeTab /> : tab === 'lecture' ? <LectureTab /> : tab === 'reference' ? <ReferenceTab /> : <ProgressTab />}
      </div>
    </div>
  )
}

function LearnTab() {
  const [goal, setGoal] = useState('')
  const [path, setPath] = useState<LearningPath | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'none' | 'error'>('idle')

  async function build() {
    if (!goal.trim()) return
    setStatus('loading'); setPath(null)
    try {
      const r = await fetch(amUrl('/api/learn/path'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: goal.trim() }) })
      if (r.status === 404) { setStatus('none'); return }
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad')
      const j = (await r.json()) as { path?: LearningPath }
      setPath(j.path ?? null); setStatus(j.path ? 'idle' : 'none')
    } catch { setStatus('error') }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <div className="flex items-center gap-2">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void build() }}
          placeholder="What do you want to master? (e.g. linear algebra, thermodynamics, calculus)"
          className="flex-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3.5 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        <button onClick={() => void build()} disabled={!goal.trim() || status === 'loading'}
          className="rounded-xl bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-semibold text-[var(--color-background-primary)] transition disabled:opacity-40">
          {status === 'loading' ? 'Charting…' : 'Chart the path'}
        </button>
      </div>

      {status === 'none' && <p className="mt-6 text-center text-[13px] text-[var(--color-text-tertiary)]">No path to that yet — try a canonical topic like <span className="text-[var(--color-text-secondary)]">linear algebra</span> or <span className="text-[var(--color-text-secondary)]">thermodynamics</span>.</p>}
      {status === 'error' && <p className="mt-6 text-center text-[13px] text-[var(--color-text-tertiary)]">Couldn’t reach the academy backend — is the runtime running?</p>}

      {path && path.path.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
            The prerequisite path to <span className="font-medium text-[var(--color-text-primary)]">{path.resolved || path.goal}</span> — {path.path.length} steps, foundations first.
          </div>
          {/* Tufte: the path itself is the graphic — a numbered spine, level as a marginal note. */}
          <ol className="relative border-l border-[var(--color-border-tertiary)] pl-5">
            {path.path.map((n, i) => {
              const lvl = LEVEL_META[n.level] ?? { label: n.level, dot: 'var(--color-text-tertiary)' }
              const isGoal = i === path.path.length - 1
              return (
                <li key={n.id} className="group relative mb-3 last:mb-0">
                  <span className="absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-background-primary)]" style={{ background: isGoal ? 'var(--color-accent)' : lvl.dot }} />
                  <div className="flex items-baseline gap-2">
                    <span className="w-5 shrink-0 tabular-nums text-[11px] text-[var(--color-text-tertiary)]">{i + 1}</span>
                    <span className={`text-[13.5px] ${isGoal ? 'font-semibold text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>{n.name}</span>
                    <span className="text-[10.5px] text-[var(--color-text-tertiary)]">{lvl.label}{n.subject ? ` · ${n.subject}` : ''}</span>
                    <button onClick={() => ask(`Teach me ${n.name} from first principles — start with what I need to know, use a worked example, then check my understanding with one question.`)}
                      className="ml-auto opacity-0 transition group-hover:opacity-100 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]">
                      Learn →
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {status === 'idle' && !path && (
        <p className="mt-8 text-center text-[13px] leading-relaxed text-[var(--color-text-tertiary)]">
          Name a goal and get the exact prerequisite ladder — from the foundations you need up to the
          graduate canon — then learn each step with your tutor.
        </p>
      )}
    </div>
  )
}

function PracticeTab() {
  const [cards, setCards] = useState<DueCard[]>([])
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    setStatus('loading'); setI(0); setFlipped(false)
    try {
      const r = await fetch(amUrl('/api/learning/srs/due'))
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad')
      const j = (await r.json()) as { due?: DueCard[] }
      setCards(j.due ?? []); setStatus('ready')
    } catch { setStatus('error') }
  }, [])
  useEffect(() => { void load() }, [load])

  async function grade(g: 0 | 1 | 2 | 3) {
    const card = cards[i]
    if (card) { try { await fetch(amUrl('/api/learning/srs/review'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: card.id, grade: g }) }) } catch { /* best-effort */ } }
    setFlipped(false)
    if (i + 1 < cards.length) setI(i + 1)
    else { setCards([]); setStatus('ready') }
  }

  if (status === 'loading') return <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">Loading your due cards…</p>
  if (status === 'error') return <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">Couldn’t reach the academy backend — is the runtime running?</p>
  if (cards.length === 0) return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing due — you’re caught up.</p>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">Cards appear as you learn. Come back to lock it in.</p>
      </div>
    </div>
  )

  const card = cards[i]!
  const GRADES: Array<{ g: 0 | 1 | 2 | 3; label: string; color: string }> = [
    { g: 0, label: 'Again', color: '#dc2626' },
    { g: 1, label: 'Hard', color: 'var(--color-attention)' },
    { g: 2, label: 'Good', color: 'var(--color-text-secondary)' },
    { g: 3, label: 'Easy', color: 'var(--color-accent)' },
  ]
  return (
    <div className="mx-auto max-w-xl px-6 py-6">
      <div className="mb-3 flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)]">
        <span>Card {i + 1} of {cards.length}</span>
        <span>spaced repetition</span>
      </div>
      <div className="min-h-[180px] rounded-2xl border border-[var(--color-border-secondary)] p-5">
        <div className="text-[14px] font-medium text-[var(--color-text-primary)]">{card.task}</div>
        {flipped && (
          <div className="mt-3 border-t border-[var(--color-border-tertiary)] pt-3 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
            {card.abstraction && <p className="mb-2">{card.abstraction}</p>}
            {card.steps && card.steps.length > 0 && (
              <ol className="ml-4 list-decimal space-y-1">{card.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
            )}
            {!card.abstraction && !card.steps?.length && <p className="text-[var(--color-text-tertiary)]">(no notes on this card)</p>}
          </div>
        )}
      </div>
      {!flipped ? (
        <button onClick={() => setFlipped(true)} className="mt-4 w-full rounded-xl border border-[var(--color-border-secondary)] py-2 text-[13px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
          Show answer
        </button>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {GRADES.map(({ g, label, color }) => (
              <button key={g} onClick={() => void grade(g)}
                className="rounded-xl border border-[var(--color-border-secondary)] py-2 text-[12.5px] font-medium transition hover:bg-[var(--color-background-secondary)]"
                style={{ color }}>
                {label}
              </button>
            ))}
          </div>
          {/* Remediation: struggling with this card → have the tutor re-teach it from first principles. */}
          <button onClick={() => ask(`I keep getting this wrong: "${card.task}". Re-teach it from first principles — the intuition, a worked example, then check me with one question.`)}
            className="mt-2 w-full text-center text-[11.5px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-accent)]">
            Re-teach this with the tutor →
          </button>
        </>
      )}
    </div>
  )
}

// Reference — the canon library: a term → its authored definition + canonical equations + related
// concepts (the OpenCourseWare pillar). Wired to /api/canon.
function ReferenceTab() {
  const [term, setTerm] = useState('')
  const [kind, setKind] = useState('definition')
  const [res, setRes] = useState<CanonResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')

  async function look() {
    if (!term.trim()) return
    setStatus('loading'); setRes(null)
    try {
      const r = await fetch(amUrl(`/api/canon?q=${encodeURIComponent(term.trim())}&kind=${kind}`))
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad')
      const j = (await r.json()) as CanonResult
      const hasContent = !!j.lookup || (j.route?.equations?.length ?? 0) > 0 || (j.route?.entities?.length ?? 0) > 0
      setRes(j); setStatus(hasContent ? 'idle' : 'empty')
    } catch { setStatus('error') }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <div className="flex items-center gap-2">
        <input value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void look() }}
          placeholder="Look up a concept (e.g. torque, eigenvalue, entropy)"
          className="flex-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3.5 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]" />
        <select value={kind} onChange={(e) => setKind(e.target.value)}
          className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-2 text-[12px] capitalize text-[var(--color-text-secondary)] outline-none">
          {['definition', 'formula', 'related'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={() => void look()} disabled={!term.trim() || status === 'loading'}
          className="rounded-xl bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-semibold text-[var(--color-background-primary)] transition disabled:opacity-40">
          {status === 'loading' ? '…' : 'Look up'}
        </button>
      </div>

      {status === 'empty' && <p className="mt-6 text-center text-[13px] text-[var(--color-text-tertiary)]">Not in the canon yet — try a core concept from math, physics, or CS.</p>}
      {status === 'error' && <p className="mt-6 text-center text-[13px] text-[var(--color-text-tertiary)]">Couldn’t reach the canon — is the runtime running?</p>}

      {res && status === 'idle' && (
        <div className="mt-5 space-y-4">
          {res.lookup && (
            <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Definition</div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-primary)]">{res.lookup}</p>
            </div>
          )}
          {(res.route?.equations?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Canonical equations</div>
              <div className="space-y-1.5">
                {res.route!.equations!.map((eq, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="text-[var(--color-text-secondary)]">{eq.name}</span>
                    <span className="font-mono text-[12px] text-[var(--color-text-primary)]">{eq.form}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(res.route?.entities?.length ?? 0) > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Related</div>
              <div className="flex flex-wrap gap-1.5">
                {res.route!.entities!.map((e) => (
                  <button key={e} onClick={() => ask(`Explain ${e} and how it relates to ${term}.`)}
                    className="rounded-full border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-accent)]">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Progress — the learner record (path to goal, gaps, next step) from /api/learning/progress. Honest empty
// state until there's a learning history.
function ProgressTab() {
  const [data, setData] = useState<Progress | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(amUrl('/api/learning/progress?id=local'))
        if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad')
        setData((await r.json()) as Progress); setStatus('ready')
      } catch { setStatus('error') }
    })()
  }, [])

  if (status === 'loading') return <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">Loading your record…</p>
  if (status === 'error') return <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-tertiary)]">Couldn’t reach the academy backend — is the runtime running?</p>

  const text = data?.artifact?.text?.trim()
  const brief = data?.brief?.trim()
  if (!text && !brief) return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">Your record is empty.</p>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">Learn and practice, and your path, gaps, and next steps build here.</p>
      </div>
    </div>
  )
  return (
    <div className="mx-auto max-w-3xl px-6 py-5 space-y-4">
      {/* Sovereign transcript: seal the local record into an offline-verifiable credential you own and can
          prove anywhere — the cloud+local seam (private record → portable proof). */}
      <SealTranscript record={[brief, text].filter(Boolean).join('\n\n')} lens={data?.artifact?.lens} />
      {brief && (
        <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Where you are</div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-primary)]">{brief}</p>
        </div>
      )}
      {text && (
        <div className="rounded-xl border border-[var(--color-border-secondary)] p-4">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Record{data?.artifact?.lens ? ` · ${data.artifact.lens}` : ''}</div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{text}</p>
        </div>
      )}
    </div>
  )
}

function SealTranscript({ record, lens }: { record: string; lens?: string }) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  async function seal() {
    setBusy(true); setFlash('')
    try {
      const r = await fetch(amUrl('/api/proof/export'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: `transcript-${lens ?? 'record'}`, answer: record, model: 'local-academy', timestamp: new Date().toISOString(), citations: [] }),
      })
      if (!r.ok) throw new Error('seal failed')
      downloadJson(await r.json(), `noetica-transcript-${lens ?? 'record'}.json`)
      setFlash('Sealed ✓')
    } catch { setFlash('Failed') } finally { setBusy(false); setTimeout(() => setFlash(''), 2000) }
  }
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3.5 py-2.5">
      <div className="min-w-0 pr-3">
        <div className="text-[12.5px] font-medium text-[var(--color-text-primary)]">Sovereign transcript</div>
        <div className="text-[11px] text-[var(--color-text-tertiary)]">Seal this record into an offline-verifiable credential — yours to keep and prove anywhere.</div>
      </div>
      <button onClick={() => void seal()} disabled={busy}
        className="shrink-0 rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-background-primary)] transition disabled:opacity-50">
        {busy ? 'Sealing…' : flash || 'Seal transcript'}
      </button>
    </div>
  )
}
