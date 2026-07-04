'use client'

/**
 * GenUIRenderer — renders validated generative-UI specs emitted by the agent.
 *
 * The agent may embed a JSON spec inside its response using the marker:
 *   [GEN_UI: {"component":"card","props":{"title":"...","body":"..."}}]
 *
 * Only whitelisted component types (card/table/chart/list/metric/form) are rendered.
 * Everything else is treated as plain text and passed through unchanged.
 * This is a DISPLAY renderer only — no arbitrary code execution.
 */

interface UISpec {
  component: string
  props: Record<string, unknown>
}

/** Split raw content into alternating text + GEN_UI spec segments. */
export function splitGenUI(content: string): Array<{ type: 'text'; text: string } | { type: 'ui'; spec: UISpec }> {
  const GEN_UI_RE = /\[GEN_UI:\s*(\{[\s\S]*?\})\]/g
  const segments: Array<{ type: 'text'; text: string } | { type: 'ui'; spec: UISpec }> = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = GEN_UI_RE.exec(content)) !== null) {
    if (match.index > last) segments.push({ type: 'text', text: content.slice(last, match.index) })
    try {
      const spec = JSON.parse(match[1]!) as UISpec
      const ALLOWED = ['card', 'table', 'chart', 'list', 'metric', 'form']
      if (ALLOWED.includes(spec.component)) {
        segments.push({ type: 'ui', spec })
      } else {
        segments.push({ type: 'text', text: match[0]! })
      }
    } catch {
      segments.push({ type: 'text', text: match[0]! })
    }
    last = match.index + match[0]!.length
  }
  if (last < content.length) segments.push({ type: 'text', text: content.slice(last) })
  return segments
}

export function hasGenUI(content: string): boolean {
  return /\[GEN_UI:\s*\{/.test(content)
}

// ── Component renderers ──────────────────────────────────────────────────────

function CardUI({ props }: { props: Record<string, unknown> }) {
  return (
    <div className="my-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
      {!!props['title'] && (
        <div className="mb-2 text-[13px] font-semibold text-[var(--color-text-primary)]">{String(props['title'])}</div>
      )}
      {!!props['body'] && (
        <div className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">{String(props['body'])}</div>
      )}
      {!!props['badge'] && (
        <div className="mt-2">
          <span className="rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
            {String(props['badge'])}
          </span>
        </div>
      )}
    </div>
  )
}

function TableUI({ props }: { props: Record<string, unknown> }) {
  const columns = Array.isArray(props['columns']) ? (props['columns'] as unknown[]).map(String) : []
  const rows = Array.isArray(props['rows']) ? (props['rows'] as unknown[][]) : []
  if (!columns.length) return null
  return (
    <div className="my-2 overflow-x-auto rounded-xl border border-[var(--color-border-secondary)]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            {columns.map((col, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--color-border-tertiary)] last:border-0 hover:bg-[var(--color-background-secondary)] transition-colors">
              {columns.map((_col, ci) => (
                <td key={ci} className="px-3 py-2 text-[var(--color-text-primary)]">{String((row as unknown[])[ci] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListUI({ props }: { props: Record<string, unknown> }) {
  const items = Array.isArray(props['items']) ? (props['items'] as unknown[]).map(String) : []
  const ordered = props['ordered'] === true
  return (
    <div className="my-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
      {!!props['title'] && (
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{String(props['title'])}</div>
      )}
      {ordered ? (
        <ol className="list-decimal space-y-1 pl-4">
          {items.map((item, i) => (
            <li key={i} className="text-[12px] text-[var(--color-text-primary)]">{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-[var(--color-text-primary)]">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MetricUI({ props }: { props: Record<string, unknown> }) {
  const delta = typeof props['delta'] === 'number' ? props['delta'] : null
  return (
    <div className="my-2 inline-flex flex-col items-start rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{String(props['label'] ?? '')}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-semibold tabular-nums text-[var(--color-text-primary)]">{String(props['value'] ?? '')}</span>
        {!!props['unit'] && <span className="mb-0.5 text-[11px] text-[var(--color-text-tertiary)]">{String(props['unit'])}</span>}
        {delta !== null && (
          <span className={`mb-0.5 text-[11px] font-semibold ${delta > 0 ? 'text-[#16a34a]' : delta < 0 ? 'text-[#dc2626]' : 'text-[var(--color-text-tertiary)]'}`}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'} {Math.abs(delta)}
          </span>
        )}
      </div>
      {!!props['caption'] && (
        <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">{String(props['caption'])}</div>
      )}
    </div>
  )
}

function ChartUI({ props }: { props: Record<string, unknown> }) {
  const kind = String(props['kind'] ?? 'bar')
  const data = Array.isArray(props['data']) ? (props['data'] as Array<{ label?: string; value?: number }>) : []
  if (!data.length) return null
  const max = Math.max(...data.map(d => d.value ?? 0), 1)
  return (
    <div className="my-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
      {!!props['title'] && (
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{String(props['title'])}</div>
      )}
      {kind === 'bar' && (
        <div className="space-y-2">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-right text-[11px] text-[var(--color-text-secondary)]">{d.label ?? ''}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${((d.value ?? 0) / max) * 100}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{d.value ?? 0}</span>
            </div>
          ))}
        </div>
      )}
      {kind === 'line' && (
        <svg viewBox={`0 0 ${data.length * 60} 60`} className="w-full" preserveAspectRatio="none" style={{ height: 60 }}>
          <polyline
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            points={data.map((d, i) => `${i * 60 + 30},${60 - ((d.value ?? 0) / max) * 50}`).join(' ')}
          />
          {data.map((d, i) => (
            <circle key={i} cx={i * 60 + 30} cy={60 - ((d.value ?? 0) / max) * 50} r="3" fill="var(--color-accent)" />
          ))}
        </svg>
      )}
    </div>
  )
}

function FormUI({ props }: { props: Record<string, unknown> }) {
  const fields = Array.isArray(props['fields']) ? (props['fields'] as Array<{ name?: string; type?: string; label?: string; placeholder?: string }>) : []
  return (
    <div className="my-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
      {!!props['title'] && (
        <div className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">{String(props['title'])}</div>
      )}
      <div className="space-y-2">
        {fields.map((field, i) => (
          <div key={i}>
            {field.label && (
              <label className="mb-0.5 block text-[11px] font-medium text-[var(--color-text-secondary)]">{field.label}</label>
            )}
            {field.type === 'textarea' ? (
              <textarea
                placeholder={field.placeholder ?? ''}
                rows={3}
                className="w-full resize-none rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            ) : (
              <input
                type={field.type ?? 'text'}
                placeholder={field.placeholder ?? ''}
                className="w-full rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            )}
          </div>
        ))}
      </div>
      {!!props['submit'] && (
        <button className="mt-3 rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90">
          {String(props['submit'])}
        </button>
      )}
    </div>
  )
}

const RENDERERS: Record<string, (props: Record<string, unknown>) => React.ReactElement | null> = {
  card:   (p) => <CardUI props={p} />,
  table:  (p) => <TableUI props={p} />,
  list:   (p) => <ListUI props={p} />,
  metric: (p) => <MetricUI props={p} />,
  chart:  (p) => <ChartUI props={p} />,
  form:   (p) => <FormUI props={p} />,
}

export function GenUIBlock({ spec }: { spec: UISpec }) {
  const renderer = RENDERERS[spec.component]
  if (!renderer) return null
  return renderer(spec.props)
}
