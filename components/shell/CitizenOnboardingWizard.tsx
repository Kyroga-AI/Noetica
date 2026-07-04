'use client'

import { useEffect, useRef, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

interface Props {
  onComplete: (name: string) => void
}

type Step = 'welcome' | 'name' | 'knowledge' | 'ready'

interface IngestedDoc {
  filename: string
  chunks: number
}

export function CitizenOnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [name, setName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [ingested, setIngested] = useState<IngestedDoc[]>([])
  const [ingesting, setIngesting] = useState(false)
  const [pseudonym, setPseudonym] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'ready') {
      fetch(amUrl('/api/identity/pseudonym'), { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok ? r.json() : null)
        .then((d: { pseudonym?: string } | null) => { if (d?.pseudonym) setPseudonym(d.pseudonym) })
        .catch(() => { /* best-effort */ })
    }
  }, [step])

  async function ingestFile(file: File): Promise<void> {
    setIngesting(true)
    try {
      // Chunked btoa — avoids O(n²) string concat on large files (e.g. multi-MB PDFs).
      const arr = new Uint8Array(await file.arrayBuffer())
      const chunks: string[] = []
      for (let i = 0; i < arr.length; i += 8192) {
        chunks.push(String.fromCharCode(...Array.from(arr.subarray(i, i + 8192))))
      }
      const dataBase64 = btoa(chunks.join(''))
      const res = await fetch(amUrl('/api/ingest/queue'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
      })
      if (res.ok || res.status === 202) {
        setIngested((prev) => [...prev, { filename: file.name, chunks: 0 }])
        // Best-effort: poll library once after a short delay to surface actual chunk count.
        setTimeout(() => {
          fetch(amUrl('/api/library'), { signal: AbortSignal.timeout(4000) })
            .then(r => r.ok ? r.json() : null)
            .then((lib: { groups?: Array<{ docs?: Array<{ filename: string; chunks: number }> }> } | null) => {
              if (!lib?.groups) return
              const doc = lib.groups.flatMap(g => g.docs ?? []).find(d => d.filename === file.name)
              if (doc && doc.chunks > 0) {
                setIngested((prev) => prev.map(d => d.filename === file.name ? { ...d, chunks: doc.chunks } : d))
              }
            })
            .catch(() => { /* best-effort */ })
        }, 3000)
      }
    } catch { /* best-effort */ } finally {
      setIngesting(false)
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) void ingestFile(f)
  }

  function finish() {
    localStorage.setItem('noetica:citizen:onboarded', '1')
    onComplete(name.trim())
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] shadow-2xl">

        {/* Step indicator */}
        <div className="flex gap-1.5 px-8 pt-6">
          {(['welcome', 'name', 'knowledge', 'ready'] as Step[]).map((s, i) => (
            <div
              key={s}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ backgroundColor: ['welcome', 'name', 'knowledge', 'ready'].indexOf(step) >= i ? 'var(--color-accent)' : 'var(--color-border-secondary)' }}
            />
          ))}
        </div>

        <div className="px-8 pb-8 pt-6">

          {/* ── Step 1: Welcome ──────────────────────────────────── */}
          {step === 'welcome' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">Welcome</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">This is your local AI.</h2>
              </div>
              <div className="flex flex-col gap-3 text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
                <p>Your data never leaves this device. No accounts. No tracking. No vendor lock-in.</p>
                <p>The model runs locally. You own the knowledge. You control what it knows, what it does, and what it can reach.</p>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 text-[12px]">
                {[
                  ['⬡', 'Local model', 'Runs on your hardware'],
                  ['⬡', 'Sovereign knowledge', 'Your documents stay on device'],
                  ['⬡', 'No accounts', 'No signup, no email, no tracking'],
                ].map(([icon, label, desc]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-[var(--color-accent)]">{icon}</span>
                    <span className="font-medium text-[var(--color-text-primary)]">{label}</span>
                    <span className="text-[var(--color-text-tertiary)]">— {desc}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setStep('name')}
                className="mt-1 w-full rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                Get started
              </button>
            </div>
          )}

          {/* ── Step 2: Name ─────────────────────────────────────── */}
          {step === 'name' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">Identity</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">What should I call you?</h2>
              </div>
              <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
                That&apos;s all we ask for. No email. No password. Just a name so your mesh can greet you.
              </p>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) setStep('knowledge') }}
                placeholder="Your name…"
                className="w-full rounded-xl border border-[var(--color-border-primary)] bg-[var(--color-background-secondary)] px-4 py-2.5 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('knowledge')}
                  className="flex-1 rounded-xl border border-[var(--color-border-primary)] py-2.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]"
                >
                  Skip
                </button>
                <button
                  onClick={() => { if (name.trim()) setStep('knowledge') }}
                  disabled={!name.trim()}
                  className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Knowledge ────────────────────────────────── */}
          {step === 'knowledge' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">Knowledge</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">Teach it something.</h2>
              </div>
              <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
                Drop a document and your mesh will index it immediately. PDFs, text, markdown — anything you&apos;d want to ask questions about.
              </p>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed py-8 text-center transition-colors"
                style={{ borderColor: dragging ? 'var(--color-accent)' : 'var(--color-border-secondary)', background: dragging ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : undefined }}
              >
                <span className="text-2xl text-[var(--color-text-tertiary)]">⬡</span>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {ingesting ? 'Indexing…' : 'Drop a file or click to browse'}
                </p>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              </div>

              {ingested.length > 0 && (
                <div className="flex flex-col gap-1">
                  {ingested.map((d) => (
                    <div key={d.filename} className="flex items-center gap-2 rounded-lg bg-[var(--color-background-secondary)] px-3 py-1.5 text-[12px]">
                      <span className="text-[var(--color-accent)]">✓</span>
                      <span className="truncate text-[var(--color-text-primary)]">{d.filename}</span>
                      <span className="ml-auto shrink-0 text-[var(--color-text-tertiary)]">{d.chunks > 0 ? `${d.chunks} chunks` : 'indexing…'}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('ready')}
                  className="flex-1 rounded-xl border border-[var(--color-border-primary)] py-2.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => setStep('ready')}
                  className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  {ingested.length > 0 ? 'Continue' : 'Skip'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Ready ────────────────────────────────────── */}
          {step === 'ready' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">Ready</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">
                  {name.trim() ? `Your mesh is ready, ${name.trim()}.` : 'Your mesh is ready.'}
                </h2>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 text-[12px]">
                {[
                  ['⬡', 'Local model active', 'Inference stays on device'],
                  ['⬡', 'Knowledge graph live', ingested.length > 0 ? `${ingested.length} document${ingested.length > 1 ? 's' : ''} · ${ingested.reduce((s, d) => s + d.chunks, 0) || 'indexing'} chunks` : 'Ready for documents'],
                  ['⬡', 'Sovereignty confirmed', 'No data leaves this device'],
                ].map(([icon, label, desc]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-[var(--color-accent)]">{icon}</span>
                    <span className="font-medium text-[var(--color-text-primary)]">{label}</span>
                    <span className="text-[var(--color-text-tertiary)]">— {desc}</span>
                  </div>
                ))}
              </div>
              {pseudonym && (
                <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Your sovereign identity</div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-[var(--color-text-primary)]">{pseudonym}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">Device-anchored — derived from a local key that never leaves this machine.</div>
                </div>
              )}
              <p className="text-[13px] text-[var(--color-text-tertiary)]">
                Try asking: &ldquo;What can you do?&rdquo; or &ldquo;Summarise my documents.&rdquo;
              </p>
              <button
                onClick={finish}
                className="w-full rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                Start talking
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
