'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

const AM_BASE =
  typeof window !== 'undefined' && (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
    ? 'http://127.0.0.1:8080'
    : ''

interface ModelStatus {
  name: string
  role: string
  sizeGb: number
  description: string
  pulled: boolean
  pct: number
  status: 'waiting' | 'starting' | 'pulling' | 'ready'
}

export function ModelSetupOverlay({ onDismiss }: { onDismiss: () => void }) {
  const [models, setModels] = useState<ModelStatus[]>([])
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const dismissedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const res = await fetch(`${AM_BASE}/api/models`)
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          models: Array<{ name: string; role: string; sizeGb: number; description: string; pulled: boolean }>
        }
        if (cancelled) return
        setModels(
          data.models.map((m) => ({
            name: m.name,
            role: m.role,
            sizeGb: m.sizeGb,
            description: m.description,
            pulled: m.pulled,
            pct: m.pulled ? 100 : 0,
            status: m.pulled ? 'ready' : 'waiting',
          }))
        )
      } catch {
        // agent-machine not yet reachable — models list stays empty until SSE connects
      }

      if (cancelled) return

      const es = new EventSource(`${AM_BASE}/api/models/stream`)
      esRef.current = es

      es.onmessage = (ev) => {
        if (cancelled) return
        try {
          const payload = JSON.parse(ev.data) as {
            type?: string
            model?: string
            status?: 'starting' | 'pulling' | 'ready'
            pct?: number
            role?: string
            sizeGb?: number
          }

          if (payload.type === 'suite_ready' || payload.type === 'connected') return

          if (payload.model && payload.status) {
            setModels((prev) => {
              const existing = prev.find((m) => m.name === payload.model)
              if (existing) {
                return prev.map((m) =>
                  m.name === payload.model
                    ? { ...m, status: payload.status!, pct: payload.pct ?? m.pct, pulled: payload.status === 'ready' }
                    : m
                )
              }
              // Model not yet in list — add it (handles late connection)
              return [
                ...prev,
                {
                  name: payload.model!,
                  role: payload.role ?? '',
                  sizeGb: payload.sizeGb ?? 0,
                  description: '',
                  pulled: payload.status === 'ready',
                  pct: payload.pct ?? 0,
                  status: payload.status!,
                },
              ]
            })
          }
        } catch {
          // malformed SSE frame — ignore
        }
      }

      es.onerror = () => {
        // connection drop is non-fatal — heartbeat will recover
      }
    }

    void init()

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [])

  // Pull all required models that are not yet pulled.
  // Called automatically once the model list loads if any are missing.
  const startPulling = useCallback(async () => {
    setPulling(true)
    setPullError(null)
    try {
      const res = await fetch(`${AM_BASE}/api/models`)
      if (!res.ok) throw new Error('Cannot reach agent-machine')
      const data = (await res.json()) as {
        models: Array<{ name: string; pulled: boolean; required: boolean }>
      }
      const needed = data.models.filter((m) => m.required && !m.pulled)
      for (const m of needed) {
        // Fire-and-forget each pull — SSE stream reports progress
        void fetch(`${AM_BASE}/api/models/pull`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: m.name }),
        })
        // Small delay between pulls so Ollama doesn't queue-saturate
        await new Promise((r) => setTimeout(r, 500))
      }
    } catch (e) {
      setPullError(String(e))
      setPulling(false)
    }
  }, [])

  // Kick off pulls once model list is loaded and any are missing
  useEffect(() => {
    if (models.length === 0) return
    const anyMissing = models.some((m) => m.status === 'waiting')
    if (anyMissing && !pulling) void startPulling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length])

  // Auto-dismiss once every model is ready
  useEffect(() => {
    if (models.length === 0) return
    const allReady = models.every((m) => m.status === 'ready')
    if (allReady && !dismissedRef.current) {
      dismissedRef.current = true
      const t = setTimeout(onDismiss, 1000)
      return () => clearTimeout(t)
    }
  }, [models, onDismiss])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'var(--color-background-primary, #0f0f0f)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--color-text-primary, #f0f0f0)',
              lineHeight: 1.3,
            }}
          >
            Setting up your local AI
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '13px',
              color: 'var(--color-text-secondary, #888)',
              lineHeight: 1.5,
            }}
          >
            Downloading once. Models run entirely on your machine — no cloud, no data leaving your device.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {models.map((model) => (
            <ModelRow key={model.name} model={model} />
          ))}
          {models.length === 0 && (
            <div
              style={{
                padding: '12px',
                fontSize: '13px',
                color: 'var(--color-text-secondary, #888)',
                borderRadius: '8px',
                background: 'var(--color-background-secondary, #1a1a1a)',
              }}
            >
              Connecting to local runtime...
            </div>
          )}
        </div>

        {pullError && (
          <div style={{ padding: '10px 12px', fontSize: '12px', color: '#f87171', background: 'rgba(248,113,113,0.08)', borderRadius: 6 }}>
            {pullError}{' '}
            <button
              onClick={() => void startPulling()}
              style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px', padding: 0 }}
            >
              Retry
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {pulling && !pullError && (
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary, #888)' }}>
              Downloading models…
            </span>
          )}
          {!pulling && !pullError && models.some(m => m.status === 'waiting') && (
            <button
              onClick={() => void startPulling()}
              style={{
                background: 'var(--color-accent, #6366f1)',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '12px',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Download models
            </button>
          )}
          {(!pulling || pullError) && <span />}
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: '1px solid var(--color-border-tertiary, #333)',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '12px',
              color: 'var(--color-text-secondary, #888)',
              cursor: 'pointer',
            }}
          >
            Skip for now (use cloud models)
          </button>
        </div>
      </div>
    </div>
  )
}

function ModelRow({ model }: { model: ModelStatus }) {
  const statusColor: Record<ModelStatus['status'], string> = {
    waiting:  'var(--color-text-secondary, #666)',
    starting: '#facc15',
    pulling:  '#60a5fa',
    ready:    '#4ade80',
  }

  const statusLabel: Record<ModelStatus['status'], string> = {
    waiting:  'waiting',
    starting: 'starting',
    pulling:  `${model.pct}%`,
    ready:    'ready',
  }

  return (
    <div
      style={{
        background: 'var(--color-background-secondary, #1a1a1a)',
        borderRadius: '8px',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--color-text-primary, #f0f0f0)',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
          >
            {model.name}
          </span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'var(--color-background-tertiary, #222)',
              color: 'var(--color-text-secondary, #888)',
              flexShrink: 0,
            }}
          >
            {model.role}
          </span>
          {model.sizeGb > 0 && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--color-text-secondary, #666)',
                flexShrink: 0,
              }}
            >
              {model.sizeGb}GB
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            color: statusColor[model.status],
            flexShrink: 0,
          }}
        >
          {statusLabel[model.status]}
        </span>
      </div>

      {model.description && (
        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary, #666)' }}>
          {model.description}
        </span>
      )}

      {(model.status === 'pulling' || model.status === 'starting') && (
        <div
          style={{
            height: '3px',
            borderRadius: '2px',
            background: 'var(--color-background-tertiary, #2a2a2a)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${model.pct}%`,
              background: '#60a5fa',
              borderRadius: '2px',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {model.status === 'ready' && (
        <div
          style={{
            height: '3px',
            borderRadius: '2px',
            background: '#4ade80',
          }}
        />
      )}
    </div>
  )
}
