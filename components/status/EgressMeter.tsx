'use client'

import { useEffect, useState } from 'react'

/**
 * EgressMeter — the visible sovereignty guarantee. Sums tokens that LEFT the device across
 * recent runs (governance ring; local/Ollama runs egress 0). Green "🔒 0 left this device" when
 * everything stayed on-device; amber "↗ N egressed" the moment anything routed to a cloud/
 * sovereign host (under the scope-d gate the operator armed). The one badge cloud apps can't show.
 */
export function EgressMeter() {
  const [egress, setEgress] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch('/api/governance/recent?limit=50')
        if (!r.ok) return
        const j = (await r.json()) as { runs?: Array<{ tokens_egressed?: number }> }
        const total = (j.runs ?? []).reduce((s, x) => s + (x.tokens_egressed ?? 0), 0)
        if (!cancelled) setEgress(total)
      } catch { /* offline — leave last value */ }
    }
    void poll()
    const id = setInterval(poll, 8000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (egress === null) return null
  const sovereign = egress === 0
  return (
    <span
      title={sovereign
        ? 'Zero egress — no data has left this device. Fully sovereign.'
        : `${egress.toLocaleString()} tokens have left this device (cloud / sovereign-host routing, under your scope-d gate).`}
      className={`hidden items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs font-semibold shadow-sm xl:inline-flex ${
        sovereign ? 'border-[#86efac] bg-[#dcfce7] text-[#16a34a]' : 'border-[#fde68a] bg-[#fef9c3] text-[#92400e]'
      }`}
    >
      <span aria-hidden>{sovereign ? '🔒' : '↗'}</span>
      {sovereign ? '0 left this device' : `${egress.toLocaleString()} egressed`}
    </span>
  )
}
