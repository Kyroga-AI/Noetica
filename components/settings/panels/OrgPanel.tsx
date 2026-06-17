'use client'

import { useState } from 'react'

const MEMBER = { name: 'Michael Heller', email: 'michael@socioprophet.ai', role: 'Owner' }

function isValidEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) }

export function OrgPanel() {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSent, setInviteSent] = useState(false)

  function sendInvite() {
    const email = inviteEmail.trim()
    if (!isValidEmail(email)) return
    const subject = encodeURIComponent('Invitation to join Socioprophet on Noetica')
    const body = encodeURIComponent(
      `Hi,\n\nI'd like to invite you to collaborate with me on Noetica.\n\nPlease reach out to michael@socioprophet.ai to get access.\n\nBest,\nMichael`
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
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">Socioprophet</div>
              <div className="text-[11px] text-[var(--color-text-tertiary)]">michael@socioprophet.ai</div>
            </div>
            <button className="ml-auto rounded-lg border border-[var(--color-border-tertiary)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:text-[#1d4ed8]">
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Members */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Members</div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              M
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[var(--color-text-primary)]">{MEMBER.name}</div>
              <div className="text-[10px] text-[var(--color-text-tertiary)]">{MEMBER.email}</div>
            </div>
            <span className="shrink-0 rounded-full bg-[rgba(29,78,216,0.10)] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">
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

      {/* Plan */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Plan</div>
        <div className="mt-3 rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[var(--color-text-primary)]">Development Preview</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">Full access during development phase</div>
            </div>
            <span className="rounded-full bg-[rgba(29,78,216,0.10)] px-2.5 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">Dev</span>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Danger zone</div>
        <div className="mt-3 rounded-2xl border border-[rgba(239,68,68,0.25)] bg-[var(--color-background-primary)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-[var(--color-text-primary)]">Delete organization</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">Permanently remove this org and all its data.</div>
            </div>
            <button className="shrink-0 rounded-lg border border-[rgba(239,68,68,0.35)] px-3 py-1.5 text-xs font-medium text-[#ef4444] transition hover:bg-[rgba(239,68,68,0.08)]">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
