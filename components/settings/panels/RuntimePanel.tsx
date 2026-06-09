'use client'

import { useSettings } from '@/lib/settings/context'

export function RuntimePanel() {
  const { settings, update } = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Runtime mode</label>
        <div className="mt-3 flex gap-2">
          {(['standalone', 'sourceos'] as const).map((m) => (
            <button
              key={m}
              onClick={() => update({ runtimeMode: m })}
              className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${
                settings.runtimeMode === m
                  ? 'border-[#1d4ed8] bg-[#eff6ff] font-semibold text-[#1d4ed8]'
                  : 'border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]'
              }`}
            >
              {m === 'sourceos' ? 'SourceOS' : 'Standalone'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Agent Machine endpoint</label>
        <p className="mt-0.5 text-xs text-[#64748b]">Local agent-machine HTTP stub. Default: http://localhost:8080</p>
        <input
          type="url"
          value={settings.agentMachineEndpoint}
          onChange={(e) => update({ agentMachineEndpoint: e.target.value })}
          placeholder="http://localhost:8080"
          className="mt-3 w-full rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#1d4ed8] focus:bg-white"
        />
      </div>

      <div className="rounded-2xl border border-[#d7dee8] bg-[#f8fafc] p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Status</div>
        <div className="mt-3 space-y-2 text-xs text-[#334155]">
          <div className="flex justify-between">
            <span>Standalone runtime</span>
            <span className="font-semibold text-[#22c55e]">Active</span>
          </div>
          <div className="flex justify-between">
            <span>Agent Machine</span>
            <span className="font-semibold text-[#94a3b8]">Not connected</span>
          </div>
          <div className="flex justify-between">
            <span>SourceOS</span>
            <span className="font-semibold text-[#94a3b8]">Not configured</span>
          </div>
        </div>
      </div>
    </div>
  )
}
