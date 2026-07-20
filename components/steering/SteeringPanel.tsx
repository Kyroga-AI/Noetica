'use client'

import { useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'
import { RiskAversionPanel } from '@/components/risk/RiskAversionPanel'
import { FeatureExplorer } from '@/components/sae/FeatureExplorer'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import type { ModelConfig } from '@/lib/types/model'
import type { SteeringConfig } from '@/lib/types/steering'
import type { WorkspaceMode } from '@/components/chat/InputArea'
import type { SaeFeature } from '@/lib/sae/features'

type SteeringPanelProps = {
  model: ModelConfig
  steering?: SteeringConfig
  thinkingBudget?: number
  temperature?: number
  maxTokens?: number
  workspaceMode: WorkspaceMode
  riskReadout?: RiskAversionLiveReadout | null
  onChange: (config: SteeringConfig | undefined) => void
  onThinkingBudgetChange: (budget: number | undefined) => void
  onTemperatureChange: (v: number | undefined) => void
  onMaxTokensChange: (v: number | undefined) => void
}

const inspectors = [
  { label: 'Steering', detail: 'SAE / local / blackbox capability state' },
  { label: 'Benchmark', detail: 'Task family, model family, outcome scoring' },
  { label: 'Governance', detail: 'Policy admission, memory scope, grants' },
  { label: 'Evidence', detail: 'Request hash, replay ref, provenance' },
  { label: 'Outcome', detail: 'Latency, route, task result, comparison' }
]

export function SteeringPanel({ model, steering, thinkingBudget, temperature, maxTokens, workspaceMode, riskReadout, onChange, onThinkingBudgetChange, onTemperatureChange, onMaxTokensChange }: SteeringPanelProps) {
  const enabled = Boolean(steering)
  const canConfigureSteering = model.steering === 'full'
  const [features, setFeatures] = useState<SaeFeature[]>([])
  const [featureQuery, setFeatureQuery] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)

  useEffect(() => {
    if (!showBrowser) return
    const modelParam = model.id ? `&model=${encodeURIComponent(model.id.split('-neuronpedia')[0])}` : ''
    const qParam = featureQuery.trim() ? `&q=${encodeURIComponent(featureQuery.trim())}` : ''
    fetch(amUrl(`/api/features?${modelParam}${qParam}`.replace(/^\?&/, '?')))
      .then((r) => r.json())
      .then((d: { features: SaeFeature[] }) => setFeatures(d.features ?? []))
      .catch(() => setFeatures([]))
  }, [showBrowser, featureQuery, model.id])
  const supportsThinking = Boolean(model.extended_thinking)

  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#1d4ed8]">Inspector</div>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">Noetica Workbench</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            Current mode: <span className="font-semibold text-[var(--color-text-primary)]">{workspaceMode}</span>. Noetica extends the chat workspace with steering, benchmarks, governance, evidence, and model-family outcomes.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#1d4ed8]">Model</div>
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
          <div className="text-xs font-semibold text-[#1d4ed8]">Workspace depth</div>
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
          <div className="text-xs font-semibold text-[#1d4ed8]">Generation</div>
          <div className="mt-3 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-[var(--color-text-secondary)]">Temperature</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)]">{temperature !== undefined ? temperature.toFixed(2) : 'default'}</span>
                  {temperature !== undefined && (
                    <button
                      className="text-xs text-[#1d4ed8] hover:underline"
                      onClick={() => onTemperatureChange(undefined)}
                    >reset</button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={temperature ?? 1}
                className="mt-1 w-full accent-[#1d4ed8]"
                onChange={(e) => onTemperatureChange(Number(e.target.value))}
              />
              <div className="mt-1 flex justify-between text-xs text-[var(--color-text-tertiary)]">
                <span>0 (precise)</span>
                <span>2 (creative)</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-[var(--color-text-secondary)]">Max tokens</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)]">{maxTokens !== undefined ? maxTokens.toLocaleString() : 'default'}</span>
                  {maxTokens !== undefined && (
                    <button
                      className="text-xs text-[#1d4ed8] hover:underline"
                      onClick={() => onMaxTokensChange(undefined)}
                    >reset</button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min="256"
                max="32768"
                step="256"
                value={maxTokens ?? 8192}
                className="mt-1 w-full accent-[#1d4ed8]"
                onChange={(e) => onMaxTokensChange(Number(e.target.value))}
              />
              <div className="mt-1 flex justify-between text-xs text-[var(--color-text-tertiary)]">
                <span>256</span>
                <span>32k</span>
              </div>
            </div>
          </div>
        </section>

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
            {/* Live SAE feature explorer (requires sae_patch.py sidecar) */}
            <FeatureExplorer
              onSelectFeature={(featureId, _act) => {
                onChange({ ...(steering ?? defaultSteering()), feature_id: String(featureId) })
              }}
            />
            {/* Feature browser */}
            <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
              <button
                type="button"
                onClick={() => setShowBrowser((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <span>Browse local feature registry</span>
                <span>{showBrowser ? '▲' : '▼'}</span>
              </button>
              {showBrowser && (
                <div className="border-t border-[var(--color-border-secondary)] p-2">
                  <input
                    className="mb-2 w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
                    placeholder="Search features…"
                    value={featureQuery}
                    onChange={(e) => setFeatureQuery(e.target.value)}
                  />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {features.length === 0 && (
                      <div className="py-2 text-center text-xs text-[var(--color-text-tertiary)]">No features found</div>
                    )}
                    {features.map((f) => (
                      <button
                        key={f.feature_id}
                        type="button"
                        onClick={() => {
                          onChange({ feature_id: f.feature_id, layer: f.layer, strength: steering?.strength ?? 0.5 })
                          setShowBrowser(false)
                        }}
                        className={`w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--color-background-primary)] ${steering?.feature_id === f.feature_id ? 'bg-[rgba(29,78,216,0.12)] text-[#60a5fa]' : 'text-[var(--color-text-secondary)]'}`}
                      >
                        <div className="font-semibold">{f.label}</div>
                        <div className="text-[var(--color-text-tertiary)]">{f.feature_id}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
