/**
 * egressAudit — the sovereignty audit artifact. Turns the governance ring into a procurement-
 * grade record: which turns left the device, when, to which provider/model, how many tokens, at
 * what cost, and under which policy verdict — plus a summary (sovereignty %). Exportable to CSV
 * for a compliance/procurement doc. Pure; the Govern panel feeds it `/api/governance/recent`.
 */

const LOCAL_PROVIDERS = new Set(['ollama', 'noetica', 'local', ''])

export interface EgressRun {
  run_id: string
  provider: string
  model_routed: string
  timestamp?: string
  tokens_egressed?: number
  cost_usd?: number
  policy_admitted: boolean
  session_id?: string
}

export interface EgressAuditRow {
  when: string
  provider: string
  model: string
  tokens_egressed: number
  cost_usd: number
  policy: string
  run_id: string
}

export interface EgressAudit {
  summary: {
    total_runs: number
    sovereign_runs: number      // stayed on-device
    egress_runs: number         // left the device
    total_tokens_egressed: number
    total_cost_usd: number
    sovereignty_pct: number     // % of runs that never left the machine
  }
  rows: EgressAuditRow[]         // the runs that DID egress, newest first
}

/** A run "egressed" if any tokens left OR it ran on a non-local provider. */
function didEgress(r: EgressRun): boolean {
  return (r.tokens_egressed ?? 0) > 0 || !LOCAL_PROVIDERS.has((r.provider || '').toLowerCase())
}

export function buildEgressAudit(runs: EgressRun[]): EgressAudit {
  const egress = runs.filter(didEgress)
  const rows: EgressAuditRow[] = egress
    .map((r) => ({
      when: r.timestamp ?? '',
      provider: r.provider || 'local',
      model: r.model_routed,
      tokens_egressed: r.tokens_egressed ?? 0,
      cost_usd: r.cost_usd ?? 0,
      policy: r.policy_admitted ? 'admitted' : 'denied',
      run_id: r.run_id,
    }))
    .sort((a, b) => b.when.localeCompare(a.when))
  const total_runs = runs.length
  const egress_runs = egress.length
  const sovereign_runs = total_runs - egress_runs
  return {
    summary: {
      total_runs,
      sovereign_runs,
      egress_runs,
      total_tokens_egressed: runs.reduce((s, r) => s + (r.tokens_egressed ?? 0), 0),
      total_cost_usd: Number(runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)),
      sovereignty_pct: total_runs ? Math.round((sovereign_runs / total_runs) * 100) : 100,
    },
    rows,
  }
}

const CSV_COLS: (keyof EgressAuditRow)[] = ['when', 'provider', 'model', 'tokens_egressed', 'cost_usd', 'policy', 'run_id']
const csvCell = (v: unknown): string => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** Serialize the audit rows to CSV (procurement/spreadsheet-ready). */
export function toCsv(audit: EgressAudit): string {
  return [CSV_COLS.join(','), ...audit.rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n')
}
