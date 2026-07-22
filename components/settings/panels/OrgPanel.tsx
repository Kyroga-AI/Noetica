'use client'

import { useEffect, useState } from 'react'
import { useIdentity, initialOf } from '@/lib/useIdentity'
import { amUrl } from '@/lib/tauri/bridge'

function isValidEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) }

interface FederationStatus {
  enabled: boolean
  baseKey?: string
  writerKey?: string
  writable?: boolean
  pumped?: number
  lastError?: string
}

/** Org knowledge federation — the ONE-TIME opt-in. Paste the org's federation key; after
 *  the org admin admits the machine key shown here, local knowledge percolates to the org
 *  graph automatically (nothing leaves before approval). */
function FederationSection() {
  const [status, setStatus] = useState<FederationStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = () => {
    fetch(amUrl('/api/federation/status'), { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((d: FederationStatus) => setStatus(d))
      .catch(() => setStatus(null))
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 15_000); return () => clearInterval(t) }, [])

  async function join() {
    setBusy(true); setError('')
    try {
      const r = await fetch(amUrl('/api/federation/optin'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseKey: keyInput.trim() }), signal: AbortSignal.timeout(15_000),
      })
      const d = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setKeyInput(''); refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'could not join') }
    finally { setBusy(false) }
  }

  async function leave() {
    setBusy(true)
    try { await fetch(amUrl('/api/federation/optout'), { method: 'POST', signal: AbortSignal.timeout(10_000) }); refresh() }
    finally { setBusy(false) }
  }

  function copyWriterKey() {
    if (!status?.writerKey) return
    void navigator.clipboard?.writeText(status.writerKey).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div>
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">Org knowledge federation</div>
      <div className="mt-3 rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
        {status === null && (
          <div className="text-[12px] text-[var(--color-text-tertiary)]">
            Agent Machine offline — start it to manage federation.
          </div>
        )}
        {status !== null && !status.enabled && (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-[var(--color-text-tertiary)]">
              Join your organization&apos;s shared knowledge graph. Opt in once with the org&apos;s
              federation key; after your admin approves this machine, what you learn locally flows
              to the org automatically. Nothing leaves before approval.
            </p>
            <div className="flex gap-2">
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Org federation key (64 hex characters)"
                className="min-w-0 flex-1 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-primary)]"
              />
              <button
                onClick={() => void join()}
                disabled={busy || !/^[0-9a-f]{64}$/i.test(keyInput.trim())}
                className="rounded-xl bg-[var(--color-text-primary)] px-4 py-2 text-[12px] font-semibold text-[var(--color-background-primary)] disabled:opacity-40"
              >
                {busy ? 'Joining…' : 'Join'}
              </button>
            </div>
            {error && <div className="text-[11px] text-red-500">{error}</div>}
          </div>
        )}
        {status?.enabled && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-[var(--color-text-primary)]">
                {status.writable
                  ? <>Connected — <span className="font-semibold">sharing knowledge with the org</span>{typeof status.pumped === 'number' ? ` (${status.pumped} items shared)` : ''}</>
                  : <>Joined — <span className="font-semibold">waiting for admin approval</span>. Nothing is shared yet.</>}
              </div>
              <span className={`h-2 w-2 shrink-0 rounded-full ${status.writable ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            </div>
            {!status.writable && status.writerKey && (
              <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-3">
                <div className="text-[11px] font-semibold text-[var(--color-text-secondary)]">Send this machine key to your org admin</div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">{status.writerKey}</code>
                  <button onClick={copyWriterKey} className="shrink-0 rounded-lg border border-[var(--color-border-tertiary)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            {status.lastError && <div className="text-[11px] text-amber-500">{status.lastError}</div>}
            <button onClick={() => void leave()} disabled={busy}
              className="text-[11px] text-[var(--color-text-tertiary)] underline-offset-2 hover:underline disabled:opacity-40">
              Leave federation (stops sharing; already-shared knowledge stays with the org)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function OrgPanel() {
  const me = useIdentity()
  const MEMBER = { name: me.displayName, email: me.email, role: 'Owner' }
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSent, setInviteSent] = useState(false)

  function sendInvite() {
    const email = inviteEmail.trim()
    if (!isValidEmail(email)) return
    const subject = encodeURIComponent('Invitation to collaborate on Noetica')
    const reachOut = me.email ? `Please reach out to ${me.email} to get access.\n\n` : ''
    const body = encodeURIComponent(
      `Hi,\n\nI'd like to invite you to collaborate with me on Noetica.\n\n${reachOut}Best,\n${me.displayName}`
    )
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank')
    setInviteSent(true)
    setTimeout(() => { setInviteSent(false); setInviteEmail(''); setInviteOpen(false) }, 2000)
  }

  return (
    <div className="space-y-6">
      {/* Org identity */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Organization</div>
        <div className="mt-3 rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              S
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">Your workspace</div>
              <div className="text-[11px] text-[var(--color-text-tertiary)]">{me.email || me.displayName}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Members */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Members</div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              {initialOf(MEMBER.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[var(--color-text-primary)]">{MEMBER.name}</div>
              <div className="text-[11px] text-[var(--color-text-tertiary)]">{MEMBER.email}</div>
            </div>
            <span className="shrink-0 rounded-full bg-[rgba(29,78,216,0.10)] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
              {MEMBER.role}
            </span>
          </div>

          {inviteOpen && (
            <div className="border-t border-[var(--color-border-tertiary)] px-4 py-3 space-y-2">
              <input
                autoFocus
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#1d4ed8]"
                onKeyDown={(e) => { if (e.key === 'Escape') setInviteOpen(false); if (e.key === 'Enter') sendInvite() }}
              />
              <div className="flex gap-2">
                <button
                  onClick={sendInvite}
                  disabled={!isValidEmail(inviteEmail) || inviteSent}
                  className="rounded-lg bg-[#1d4ed8] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50"
                >
                  {inviteSent ? 'Sent ✓' : 'Send invite'}
                </button>
                <button
                  onClick={() => setInviteOpen(false)}
                  className="rounded-lg border border-[var(--color-border-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {!inviteOpen && (
          <button
            onClick={() => setInviteOpen(true)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--color-border-secondary)] py-2 text-xs text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Invite member
          </button>
        )}
      </div>

      {/* Org knowledge federation — the one-time opt-in to the org's shared graph */}
      <FederationSection />

      {/* Plan */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Plan</div>
        <div className="mt-3 rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[var(--color-text-primary)]">Development Preview</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">Full access during development phase</div>
            </div>
            <span className="rounded-full bg-[rgba(29,78,216,0.10)] px-2.5 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">Dev</span>
          </div>
        </div>
      </div>

    </div>
  )
}
