type StatusTone = 'neutral' | 'ok' | 'warn' | 'deferred'

type StatusChipProps = {
  label: string
  value: string
  tone?: StatusTone
}

const toneClasses: Record<StatusTone, string> = {
  neutral: 'border-white/10 bg-white/[0.045] text-neutral-300',
  ok: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  warn: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
  deferred: 'border-sky-400/20 bg-sky-400/10 text-sky-200'
}

export function StatusChip({ label, value, tone = 'neutral' }: StatusChipProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${toneClasses[tone]}`}>
      <span className="text-neutral-400">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}
