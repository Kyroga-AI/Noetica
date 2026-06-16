'use client'

import { useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'

type ProviderKey = 'anthropic' | 'openai'
type VerifyState = 'idle' | 'checking' | 'ok' | 'error'

const PROVIDERS: {
  id: ProviderKey
  label: string
  color: string
  bg: string
  keyPlaceholder: string
  keyPrefix: string
  docsUrl: string
  consoleUrl: string
  consoleLabel: string
  description: string
  settingsKey: 'anthropicApiKey' | 'openaiApiKey'
}[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    color: '#c96442',
    bg: '#fff7f5',
    keyPlaceholder: 'sk-ant-…',
    keyPrefix: 'sk-ant-',
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'console.anthropic.com',
    description: 'Powers Claude models — Sonnet, Opus, Haiku.',
    settingsKey: 'anthropicApiKey',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    color: '#10a37f',
    bg: '#f0fdf9',
    keyPlaceholder: 'sk-…',
    keyPrefix: 'sk-',
    docsUrl: 'https://platform.openai.com/docs/quickstart',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'platform.openai.com',
    description: 'Powers GPT-4o and GPT-4o mini.',
    settingsKey: 'openaiApiKey',
  },
]

function ProviderRow({
  provider,
  value,
  onChange,
}: {
  provider: typeof PROVIDERS[number]
  value: string
  onChange: (v: string) => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [verifyError, setVerifyError] = useState('')

  async function verify() {
    const key = value.trim()
    if (!key) return
    setVerifyState('checking')
    setVerifyError('')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: `setup-verify-${provider.id}`,
          mode: 'standalone',
          model_id: provider.id === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini',
          messages: [{ id: 'ping', role: 'user', content: 'Reply with one word: pong', created_at: new Date().toISOString() }],
          provider_keys: { [provider.id]: key },
        }),
      })
      if (res.ok) {
        setVerifyState('ok')
      } else {
        const text = await res.text()
        setVerifyState('error')
        setVerifyError(text.includes('auth') || text.includes('401') || text.includes('key')
          ? 'Invalid API key — check and try again.'
          : `Verification failed (${res.status})`)
      }
    } catch {
      setVerifyState('error')
      setVerifyError('Could not reach the API endpoint.')
    }
  }

  const hasKey = value.trim().length > 0

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ borderColor: hasKey && verifyState === 'ok' ? '#bbf7d0' : 'var(--color-border-secondary)', background: verifyState === 'ok' ? '#f0fdf4' : provider.bg }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: provider.color }}>
          {provider.label[0]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{provider.label}</span>
            {verifyState === 'ok' && (
              <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">Verified</span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">{provider.description}</p>
        </div>
        <a
          href={provider.consoleUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-80"
          style={{ borderColor: provider.color + '44', color: provider.color }}
        >
          Get key ↗
        </a>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={revealed ? 'text' : 'password'}
            value={value}
            onChange={(e) => { onChange(e.target.value); setVerifyState('idle') }}
            placeholder={provider.keyPlaceholder}
            className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] outline-none focus:border-[#93c5fd]"
            onKeyDown={(e) => { if (e.key === 'Enter') void verify() }}
          />
        </div>
        <button
          onClick={() => setRevealed((r) => !r)}
          className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 text-xs text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
        <button
          onClick={() => void verify()}
          disabled={!hasKey || verifyState === 'checking'}
          className="rounded-xl px-3 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
          style={{ background: provider.color }}
        >
          {verifyState === 'checking' ? 'Checking…' : verifyState === 'ok' ? 'Re-verify' : 'Verify'}
        </button>
      </div>

      {verifyState === 'error' && (
        <p className="text-[11px] text-[#dc2626]">{verifyError}</p>
      )}
    </div>
  )
}

export function ProviderSetupModal({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings()
  const [anthropicKey, setAnthropicKey] = useState(settings.anthropicApiKey ?? '')
  const [openaiKey, setOpenaiKey] = useState(settings.openaiApiKey ?? '')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    const patch: Record<string, string> = {}
    if (anthropicKey.trim()) patch.anthropicApiKey = anthropicKey.trim()
    if (openaiKey.trim()) patch.openaiApiKey = openaiKey.trim()
    if (Object.keys(patch).length > 0) update(patch)
    onClose()
  }

  const hasAny = anthropicKey.trim().length > 0 || openaiKey.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-lg rounded-3xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-2xl">
        {/* Header */}
        <div className="border-b border-[var(--color-border-secondary)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Connect AI providers</h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                Add at least one API key to start chatting. Keys are stored locally — never sent to third parties.
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 shrink-0 rounded-lg p-1.5 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Provider rows */}
        <div className="px-6 py-5 space-y-4">
          <ProviderRow
            provider={PROVIDERS[0]}
            value={anthropicKey}
            onChange={setAnthropicKey}
          />
          <ProviderRow
            provider={PROVIDERS[1]}
            value={openaiKey}
            onChange={setOpenaiKey}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--color-border-secondary)] px-6 py-4">
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            You can update keys anytime in Settings → Models.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-[var(--color-border-secondary)] px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]"
            >
              Skip
            </button>
            <button
              onClick={save}
              disabled={!hasAny}
              className="rounded-xl bg-[#1d4ed8] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-40"
            >
              Save & continue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
