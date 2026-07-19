'use client'

import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'noetica_onboarding_v1'

const PILLARS = [
  {
    icon: '⚖',
    title: 'Best-of-N deliberation',
    body: 'Each question generates multiple candidates at different temperatures. The Critic scores them on grounding, belief alignment, and self-consistency — and ships only the winner.',
  },
  {
    icon: '🛡',
    title: 'Critic gate',
    body: 'Low-worth answers escalate to stronger models automatically. Contradictions surface as warnings. You see the gate decision in the Trace → Deliberation section of every reply.',
  },
  {
    icon: '🧭',
    title: 'Complexity discipline',
    body: 'Every question is classified (code / reason / lookup / prove / search-verify) and routed to a matching strategy. The posture + calibrated confidence appear in Trace → Discipline.',
  },
  {
    icon: '🔒',
    title: 'Local-first & sovereign',
    body: 'Models run on your device via Ollama. Nothing leaves without your consent. The green lock in the metadata row means the answer never touched an external server.',
  },
]

export function OnboardingCard() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(DISMISSED_KEY)) setVisible(true)
    } catch { /* SSR or private mode */ }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="mx-auto mb-4 w-full max-w-3xl rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">How Noetica thinks</p>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
            Your local AI mesh — deliberates, verifies, and stays on your device.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-full p-1 text-[var(--color-text-tertiary)] transition hover:bg-[#dbeafe] hover:text-[var(--color-text-primary)]"
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PILLARS.map((p) => (
          <div key={p.title} className="rounded-xl border border-[#bfdbfe] bg-white/70 px-3 py-2.5">
            <div className="text-base leading-none">{p.icon}</div>
            <div className="mt-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]">{p.title}</div>
            <p className="mt-1 text-[10px] leading-[1.55] text-[var(--color-text-secondary)]">{p.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-2.5 text-[10px] text-[var(--color-text-tertiary)]">
        Tip — open any reply&apos;s <span className="font-medium">▶ Trace</span> disclosure to see the live scores, grounding atoms, and routing decision.
      </p>
    </div>
  )
}
