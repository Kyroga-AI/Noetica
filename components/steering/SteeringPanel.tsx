'use client'

import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'

type SteeringPanelProps = {
  model: ModelConfig
  steering?: SteeringConfig
  onChange: (config: SteeringConfig | undefined) => void
}

export function SteeringPanel({ model, steering, onChange }: SteeringPanelProps) {
  const enabled = Boolean(steering)
  const canConfigureSteering = model.steering === 'full'

  return (
    <aside className="hidden min-h-0 overflow-y-auto bg-noetica-light/40 p-5 lg:block">
      <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">Model Capability</div>
        <h2 className="mt-2 text-lg font-semibold text-slate-950">Steering + Provenance</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Noetica separates full SAE steering, local open-weight steering, and blackbox provenance. Never represent prompt-level behavior as SAE steering.
        </p>

        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-slate-600">
          Active model: <span className="font-semibold text-slate-900">{model.label}</span>
          <br />
          Steering tier: <span className="font-semibold">{model.steering}</span>
          <br />
          SAE source: <span className="font-semibold">{model.sae_source ?? 'none'}</span>
        </div>

        <CapabilityNotice model={model} />

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
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
            className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="Feature ID"
            value={steering?.feature_id ?? ''}
            disabled={!enabled || !canConfigureSteering}
            onChange={(event) => onChange({ ...(steering ?? defaultSteering()), feature_id: event.target.value })}
          />
          <input
            className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="Layer"
            value={steering?.layer ?? ''}
            disabled={!enabled || !canConfigureSteering}
            onChange={(event) => onChange({ ...(steering ?? defaultSteering()), layer: event.target.value })}
          />
          <input
            className="w-full"
            type="range"
            min="-2"
            max="2"
            step="0.1"
            value={steering?.strength ?? 0}
            disabled={!enabled || !canConfigureSteering}
            onChange={(event) => onChange({ ...(steering ?? defaultSteering()), strength: Number(event.target.value) })}
          />
          <div className="text-xs text-slate-500">Strength: {steering?.strength ?? 0}</div>
        </div>
      </div>
    </aside>
  )
}

function CapabilityNotice({ model }: { model: ModelConfig }) {
  if (model.steering === 'full') {
    return (
      <div className="mt-4 rounded-xl border border-blue-100 bg-white p-3 text-xs leading-5 text-slate-600">
        Full SAE steering path. M2b may apply hosted SAE features through {model.sae_source ?? 'a configured SAE source'}.
      </div>
    )
  }

  if (model.steering === 'local') {
    return (
      <div className="mt-4 rounded-xl border border-blue-100 bg-white p-3 text-xs leading-5 text-slate-600">
        Local SAE path. Requires SourceOS mode and Agent Machine local inference before steering can be applied.
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-100 bg-white p-3 text-xs leading-5 text-slate-600">
      Blackbox provider path. SAE steering is unavailable; Noetica should show provenance and tamper-evidence instead.
    </div>
  )
}

function defaultSteering(): SteeringConfig {
  return { feature_id: 'placeholder-feature', layer: 'resid_post', strength: 0.5 }
}
