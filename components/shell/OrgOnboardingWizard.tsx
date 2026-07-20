'use client'

import { useEffect, useRef, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

interface Props {
  onComplete: (orgName: string) => void
  onDismiss: () => void
}

type Step = 'welcome' | 'identity' | 'governance' | 'knowledge' | 'ready'
const STEPS: Step[] = ['welcome', 'identity', 'governance', 'knowledge', 'ready']

const ORG_TYPES = ['Business', 'NGO / Charity', 'Research', 'Government', 'Team / Project'] as const
type OrgType = typeof ORG_TYPES[number]

type PolicyProfile = 'default' | 'strict' | 'permissive'
const POLICY_DESC: Record<PolicyProfile, string> = {
  default:    'Standard controls — refusal checks, evidence refs required for factual claims.',
  strict:     'Legal-grade — full hash provenance, mandatory evidence bundles, all outputs reviewed.',
  permissive: 'Research mode — minimal restrictions, policy checks recorded but non-blocking.',
}

interface IngestedDoc { filename: string }

export function OrgOnboardingWizard({ onComplete, onDismiss }: Props) {
  const [step, setStep]         = useState<Step>('welcome')
  const [orgName, setOrgName]   = useState('')
  const [orgType, setOrgType]   = useState<OrgType | ''>('')
  const [policy, setPolicy]     = useState<PolicyProfile>('default')
  const [dragging, setDragging] = useState(false)
  const [ingested, setIngested] = useState<IngestedDoc[]>([])
  const [ingesting, setIngesting] = useState(false)
  const [pseudonym, setPseudonym] = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const fileInputRef            = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step !== 'ready') return
    fetch(amUrl('/api/identity/pseudonym?scope=org'), { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { pseudonym?: string } | null) => { if (d?.pseudonym) setPseudonym(d.pseudonym) })
      .catch(() => { /* best-effort */ })
  }, [step])

  async function ingestFile(file: File): Promise<void> {
    setIngesting(true)
    try {
      const arr = new Uint8Array(await file.arrayBuffer())
      const chunks: string[] = []
      for (let i = 0; i < arr.length; i += 8192) {
        chunks.push(String.fromCharCode(...Array.from(arr.subarray(i, i + 8192))))
      }
      const res = await fetch(amUrl('/api/ingest/queue'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64: btoa(chunks.join('')) }),
      })
      if (res.ok || res.status === 202) setIngested(prev => [...prev, { filename: file.name }])
    } catch { /* best-effort */ } finally { setIngesting(false) }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) void ingestFile(f)
  }

  async function finish() {
    setSaving(true)
    try {
      await fetch(amUrl('/api/identity/org'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim(), type: orgType || null, policyProfile: policy }),
      })
    } catch { /* best-effort */ } finally { setSaving(false) }
    localStorage.setItem('noetica:org:onboarded', '1')
    onComplete(orgName.trim())
  }

  // Escapable at any point — mark it seen so it doesn't nag again, then close.
  function dismiss() {
    localStorage.setItem('noetica:org:onboarded', '1')
    onDismiss()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={dismiss}>
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Close — skippable at any step (click outside, ✕, or Esc) */}
        <button
          onClick={dismiss}
          title="Close (Esc)"
          aria-label="Close onboarding"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-8 pt-6">
          {STEPS.map((s, i) => (
            <div key={s} className="h-1 flex-1 rounded-full transition-colors"
              style={{ backgroundColor: stepIndex >= i ? 'var(--color-accent)' : 'var(--color-border-secondary)' }} />
          ))}
        </div>

        <div className="px-8 pb-8 pt-6">

          {/* ── Welcome ──────────────────────────────────────────────── */}
          {step === 'welcome' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semiboldst text-[var(--color-text-tertiary)]">Organisation</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">Sovereign mesh for your organisation.</h2>
              </div>
              <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
                Configure a governed workspace your team can trust. Knowledge stays on your infrastructure. Policies stay under your control.
              </p>
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 text-[12px]">
                {[
                  ['⬡', 'Sovereign knowledge', 'Documents and graph stay on your infra'],
                  ['⬡', 'Governed AI', 'Policy profile controls what the agent can do'],
                  ['⬡', 'Auditable', 'Every agent action is evidence-linked'],
                ].map(([icon, label, desc]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-[var(--color-accent)]">{icon}</span>
                    <span className="font-medium text-[var(--color-text-primary)]">{label}</span>
                    <span className="text-[var(--color-text-tertiary)]">— {desc}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setStep('identity')}
                className="mt-1 w-full rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90">
                Set up organisation
              </button>
            </div>
          )}

          {/* ── Identity ─────────────────────────────────────────────── */}
          {step === 'identity' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semiboldst text-[var(--color-text-tertiary)]">Identity</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">Name your organisation.</h2>
              </div>
              <input autoFocus type="text" value={orgName} onChange={e => setOrgName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && orgName.trim()) setStep('governance') }}
                placeholder="Organisation name…"
                className="w-full rounded-xl border border-[var(--color-border-primary)] bg-[var(--color-background-secondary)] px-4 py-2.5 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]" />
              <div>
                <p className="mb-2 text-[11px] text-[var(--color-text-tertiary)]">Organisation type</p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {ORG_TYPES.map(t => (
                    <button key={t} onClick={() => setOrgType(t)}
                      className={`rounded-xl border px-3 py-2 text-[12px] transition ${orgType === t ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] font-semibold text-[var(--color-accent)]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-primary)]'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('welcome')}
                  className="flex-1 rounded-xl border border-[var(--color-border-primary)] py-2.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
                  Back
                </button>
                <button onClick={() => { if (orgName.trim()) setStep('governance') }} disabled={!orgName.trim()}
                  className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Governance ───────────────────────────────────────────── */}
          {step === 'governance' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semiboldst text-[var(--color-text-tertiary)]">Governance</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">Choose a policy profile.</h2>
              </div>
              <div className="flex flex-col gap-2">
                {(['default', 'strict', 'permissive'] as PolicyProfile[]).map(p => (
                  <button key={p} onClick={() => setPolicy(p)}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition ${policy === p ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]' : 'border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]'}`}>
                    <span className={`text-[12px] font-semibold capitalize ${policy === p ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>{p}</span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">{POLICY_DESC[p]}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('identity')}
                  className="flex-1 rounded-xl border border-[var(--color-border-primary)] py-2.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
                  Back
                </button>
                <button onClick={() => setStep('knowledge')}
                  className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Knowledge ────────────────────────────────────────────── */}
          {step === 'knowledge' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semiboldst text-[var(--color-text-tertiary)]">Knowledge</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">Add your organisation&apos;s knowledge.</h2>
              </div>
              <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
                Policies, playbooks, org charts, reports — anything the mesh should know about your organisation.
              </p>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed py-8 text-center transition-colors"
                style={{ borderColor: dragging ? 'var(--color-accent)' : 'var(--color-border-secondary)', background: dragging ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : undefined }}>
                <span className="text-2xl text-[var(--color-text-tertiary)]">⬡</span>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {ingesting ? 'Indexing…' : 'Drop files or click to browse'}
                </p>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
              </div>
              {ingested.length > 0 && (
                <div className="flex flex-col gap-1">
                  {ingested.map(d => (
                    <div key={d.filename} className="flex items-center gap-2 rounded-lg bg-[var(--color-background-secondary)] px-3 py-1.5 text-[12px]">
                      <span className="text-[var(--color-accent)]">✓</span>
                      <span className="truncate text-[var(--color-text-primary)]">{d.filename}</span>
                      <span className="ml-auto shrink-0 text-[var(--color-text-tertiary)]">queued</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setStep('governance')}
                  className="flex-1 rounded-xl border border-[var(--color-border-primary)] py-2.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
                  Back
                </button>
                <button onClick={() => setStep('ready')}
                  className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90">
                  {ingested.length > 0 ? 'Continue' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {/* ── Ready ────────────────────────────────────────────────── */}
          {step === 'ready' && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[11px] font-semiboldst text-[var(--color-text-tertiary)]">Ready</p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">
                  {orgName.trim() ? `${orgName.trim()} is configured.` : 'Organisation configured.'}
                </h2>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 text-[12px]">
                {[
                  ['⬡', 'Sovereign mesh',       'Knowledge stays on your infrastructure'],
                  ['⬡', `Policy: ${policy}`,    POLICY_DESC[policy].split(' — ')[0]!],
                  ['⬡', 'Audit trail',          'Every agent action is evidence-linked'],
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
                  <div className="mb-1 text-[11px] font-semiboldr text-[var(--color-text-tertiary)]">Org sovereign identity</div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-[var(--color-text-primary)]">{pseudonym}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Org-scoped pseudonym — unlinkable from personal identity.</div>
                </div>
              )}
              <button onClick={() => void finish()} disabled={saving}
                className="w-full rounded-xl bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Finish setup'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
