'use client'

import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'
import type { WorkspaceMode } from '@/components/chat/InputArea'

type SteeringPanelProps = {
  model: ModelConfig
  steering?: SteeringConfig
  workspaceMode: WorkspaceMode
  onChange: (config: SteeringConfig | undefined) => void
}

const inspectors = [
  { label: 'Steering', detail: 'SAE / local / blackbox capability state' },
  { label: 'Benchmark', detail: 'Task family, model family, outcome scoring' },
  { label: 'Governance', detail: 'Policy admission, memory scope, grants' },
  { label: 'Evidence', detail: 'Request hash, replay ref, provenance' },
  { label: 'Outcome', detail: 'Latency, route, task result, comparison' }
]

export function SteeringPanel({ model, steering, workspaceMode, onChange }: SteeringPanelProps) {
  const enabled = Boolean(steering)
  const canConfigureSteering = model.steering === 'full'

  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[#d7dee8] bg-[#f8fafc] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Inspector</div>
          <h2 className="mt-2 text-lg font-semibold text-[#0f172a]">Noetica Workbench</h2>
          <p className="mt-2 text-sm leading-6 text-[#64748b]">
            Current mode: <span className="font-semibold text-[#0f172a]">{workspaceMode}</span>. Noetica extends the chat workspace with steering, benchmarks, governance, evidence, and model-family outcomes.
          </p>
        </section>

        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Model</div>
          <div className="mt-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-3 text-xs leading-5 text-[#334155]">
            Active model: <span className="font-semibold text-[#0f172a]">{model.label}</span>
            <br />
            Steering tier: <span className="font-semibold text-[#0f172a]">{model.steering}</span>
            <br />
            SAE source: <span className="font-semibold text-[#0f172a]">{model.sae_source ?? 'none'}</span>
          </div>
          <CapabilityNotice model={model} />
        </section>

        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Workspace depth</div>
          <div className="mt-3 space-y-2">
            {inspectors.map((item) => (
              <div key={item.label} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="text-sm font-semibold text-[#0f172a]">{item.label}</div>
                <p className="mt-1 text-xs leading-5 text-[#64748b]">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <label className="flex items-center gap-2 text-sm text-[#334155]">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canConfigureSteering}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? { feature_id: 'placeholder-feature', layer: 'resid_post', strength: 0.5 }
                    : undefined
                )
              }}
            />
            Enable SAE steering intent
          </label>

          <div className="mt-4 space-y-3 opacity-100">
            <input
              className="w-full rounded-xl border border-[#bfdbfe] px-3 py-2 text-sm disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
              placeholder="Feature ID"
              value={steering?.feature_id ?? ''}
              disabled={!enabled || !canConfigureSteering}
              onChange={(event) => onChange({ ...(steering ?? defaultSteering()), feature_id: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-[#bfdbfe] px-3 py-2 text-sm disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
              placeholder="Layer"
              value={steering?.layer ?? ''}
              disabled={!enabled || !canConfigureSteering}
              onChange={(event) => onChange({ ...(steering ?? defaultSteering()), layer: event.target.value })}
            />
            <input
              className="w-full accent-[#1d4ed8]"
              type="range"
              min="-2"
              max="2"
              step="0.1"
              value={steering?.strength ?? 0}
              disabled={!enabled || !canConfigureSteering}
              onChange={(event) => onChange({ ...(steering ?? defaultSteering()), strength: Number(event.target.value) })}
            />
            <div className="text-xs text-[#64748b]">Strength: {steering?.strength ?? 0}</div>
          </div>
        </section>
      </div>
    </aside>
  )
}

function CapabilityNotice({ model }: { model: ModelConfig }) {
  if (model.steering === 'full') {
    return (
      <div className="mt-4 rounded-xl border border-[#d7dee8] bg-white p-3 text-xs leading-5 text-[#64748b]">
        Full SAE steering path. M2b may apply hosted SAE features through {model.sae_source ?? 'a configured SAE source'}.
      </div>
    )
  }

  if (model.steering === 'local') {
    return (
      <div className="mt-4 rounded-xl border border-[#d7dee8] bg-white p-3 text-xs leading-5 text-[#64748b]">
        Local SAE path. Requires SourceOS mode and Agent Machine local inference before steering can be applied.
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-[#d7dee8] bg-white p-3 text-xs leading-5 text-[#64748b]">
      Blackbox provider path. SAE steering is unavailable; Noetica should show provenance and tamper-evidence instead.
    </div>
  )
}

function defaultSteering(): SteeringConfig {
  return { feature_id: 'placeholder-feature', layer: 'resid_post', strength: 0.5 }
}
