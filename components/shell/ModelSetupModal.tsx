'use client'

import { useEffect, useState } from 'react'

interface ModelStatus {
  name: string
  role: string
  description: string
  sizeGb: number
  pulled: boolean
  ollamaRunning: boolean
}

interface ModelsResponse {
  ollamaRunning: boolean
  allPulled: boolean
  models: ModelStatus[]
}

interface Props {
  agentMachineEndpoint: string
  onDismiss: () => void
}

export function ModelSetupModal({ agentMachineEndpoint, onDismiss }: Props) {
  const [status, setStatus] = useState<ModelsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)

  async function fetchStatus() {
    try {
      const res = await fetch(`${agentMachineEndpoint}/api/models`)
      if (res.ok) setStatus(await res.json() as ModelsResponse)
    } catch {
      setError('Cannot reach Agent Machine. Make sure it is running.')
    }
  }

  useEffect(() => {
    void fetchStatus()
    const id = setInterval(() => { void fetchStatus() }, 4_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMachineEndpoint])

  useEffect(() => {
    if (status?.allPulled) {
      // Auto-dismiss after all models are ready
      const id = setTimeout(onDismiss, 1_500)
      return () => clearTimeout(id)
    }
  }, [status?.allPulled, onDismiss])

  async function startPull() {
    if (!status?.ollamaRunning) return
    setPulling(true)
    try {
      // Pull models in priority order via the agent-machine pull endpoint (if exists)
      // or fall back to direct Ollama API
      const unpulled = status.models.filter((m) => !m.pulled).map((m) => m.name)
      for (const model of unpulled) {
        await fetch('http://127.0.0.1:11434/api/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: false }),
        })
        await fetchStatus()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed')
    } finally {
      setPulling(false)
    }
  }

  const totalGb = status?.models.reduce((s, m) => s + (m.pulled ? 0 : m.sizeGb), 0) ?? 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '2rem',
          width: 480,
          maxWidth: '90vw',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem', fontSize: 18, color: 'var(--foreground)' }}>
          Download Local Models
        </h2>
        <p style={{ margin: '0 0 1.5rem', fontSize: 13, color: 'var(--muted)' }}>
          Noetica runs models locally using Ollama. Download the model suite once
          — they stay on your machine and work offline.
        </p>

        {error && (
          <p style={{ color: 'var(--error, #f87171)', fontSize: 13, marginBottom: 12 }}>
            {error}
          </p>
        )}

        {!status ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Checking model status…</p>
        ) : !status.ollamaRunning ? (
          <p style={{ color: 'var(--warning, #fbbf24)', fontSize: 13 }}>
            Ollama is not running. Start it with <code>ollama serve</code> or install from{' '}
            <strong>ollama.com</strong>.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {status.models.map((m) => (
              <div
                key={m.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: 'var(--surface-alt, rgba(255,255,255,0.04))',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: m.pulled ? '#22c55e' : 'var(--muted)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                    {m.name}
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        fontWeight: 400,
                        color: 'var(--muted)',
                        background: 'var(--surface-alt, rgba(255,255,255,0.08))',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {m.role}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {m.description}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                  {m.pulled ? (
                    <span style={{ color: '#22c55e' }}>Ready</span>
                  ) : (
                    `${m.sizeGb} GB`
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          {totalGb > 0 && (
            <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 'auto' }}>
              ~{totalGb.toFixed(1)} GB to download
            </span>
          )}
          <button
            onClick={onDismiss}
            style={{
              padding: '7px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Skip for now
          </button>
          {status?.ollamaRunning && !status.allPulled && (
            <button
              onClick={() => { void startPull() }}
              disabled={pulling}
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent, #7c3aed)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: pulling ? 'default' : 'pointer',
                opacity: pulling ? 0.7 : 1,
              }}
            >
              {pulling ? 'Downloading…' : 'Download Models'}
            </button>
          )}
          {status?.allPulled && (
            <button
              onClick={onDismiss}
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#22c55e',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              All models ready
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
