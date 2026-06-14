'use client'

import { RiskAversionPanel } from '@/components/risk/RiskAversionPanel'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'
import type { WorkspaceMode } from '@/components/chat/InputArea'

type SteeringPanelProps = {
  model: ModelConfig
  steering?: SteeringConfig
  thinkingBudget?: number
  workspaceMode: WorkspaceMode
  riskReadout?: RiskAversionLiveReadout | null
  onChange: (config: SteeringConfig | undefined) => void
  onThinkingBudgetChange: (budget: number | undefined) => void
}

const inspectors = [
  { label: 'Steering', detail: 'SAE / local / blackbox capability state' },
  { label: 'Benchmark', detail: 'Task family, model family, outcome scoring' },
  { label: 'Governance', detail: 'Policy admission, memory scope, grants' },
  { label: 'Evidence', detail: 'Request hash, replay ref, provenance' },
  { label: 'Outcome', detail: 'Latency, route, task result, comparison' }
]

export function SteeringPanel({ model, steering, thinkingBudget, workspaceMode, riskReadout, onChange, onThinkingBudgetChange }: SteeringPanelProps) {
  const enabled = Boolean(steering)
  const canConfigureSteering = model.steering === 'full'
  const supportsThinking = Boolean(model.extended_thinking)

  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Inspector</div>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">Noetica Workbench</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            Current mode: <span className="font-semibold text-[var(--color-text-primary)]">{workspaceMode}</span>. Noetica extends the chat workspace with steering, benchmarks, governance, evidence, and model-family outcomes.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Model</div>
          <div className="mt-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
            Active model: <span className="font-semibold text-[var(--color-text-primary)]">{model.label}</span>
            <br />
            Steering tier: <span className="font-semibold text-[var(--color-text-primary)]">{model.steering}</span>
            <br />
            SAE source: <span className="font-semibold text-[var(--color-text-primary)]">{model.sae_source ?? 'none'}</span>
          </div>
          <CapabilityNotice model={model} />
        </section>

        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Workspace depth</div>
          <div className="mt-3 space-y-2">
            {inspectors.map((item) => (
              <div key={item.label} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</div>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {supportsThinking && (
          <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={Boolean(thinkingBudget)}
                onChange={(e) => onThinkingBudgetChange(e.target.checked ? 8000 : undefined)}
              />
              Extended thinking
            </label>
            {thinkingBudget && (
              <div className="mt-3 space-y-1">
                <input
                  type="range"
                  min="1000"
                  max="32000"
                  step="1000"
                  value={thinkingBudget}
                  className="w-full accent-[#1d4ed8]"
                  onChange={(e) => onThinkingBudgetChange(Number(e.target.value))}
                />
                <div className="text-xs text-[var(--color-text-secondary)]">Budget: {thinkingBudget.toLocaleString()} tokens</div>
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
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
              className="w-full rounded-xl border border-[#bfdbfe] px-3 py-2 text-sm disabled:bg-[var(--color-background-secondary)] disabled:text-[var(--color-text-tertiary)]"
              placeholder="Feature ID"
              value={steering?.feature_id ?? ''}
              disabled={!enabled || !canConfigureSteering}
              onChange={(event) => onChange({ ...(steering ?? defaultSteering()), feature_id: event.target.value })}
            />
            <input
              className="w-full rounded-xl border border-[#bfdbfe] px-3 py-2 text-sm disabled:bg-[var(--color-background-secondary)] disabled:text-[var(--color-text-tertiary)]"
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
            <div className="text-xs text-[var(--color-text-secondary)]">Strength: {steering?.strength ?? 0}</div>
          </div>
        </section>
      </div>
      <RiskAversionPanel readout={riskReadout} />
    </aside>
  )
}

function CapabilityNotice({ model }: { model: ModelConfig }) {
  if (model.steering === 'full') {
    return (
      <div className="mt-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        Full SAE steering path. M2b may apply hosted SAE features through {model.sae_source ?? 'a configured SAE source'}.
      </div>
    )
  }

  if (model.steering === 'local') {
    return (
      <div className="mt-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        Local SAE path. Requires SourceOS mode and Agent Machine local inference before steering can be applied.
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
      Blackbox provider path. SAE steering is unavailable; Noetica should show provenance and tamper-evidence instead.
    </div>
  )
}

function defaultSteering(): SteeringConfig {
  return { feature_id: 'placeholder-feature', layer: 'resid_post', strength: 0.5 }
}
