/**
 * pipelines.ts — Workstation → Pipelines: the local GitOps view.
 *
 * The porter/continuum control plane is PR-driven GitOps — the porter-shim writes to Git and Argo CD
 * reconciles. This surfaces that: the Argo Applications in the local cluster with their sync + health
 * status, plus detection of the GitOps/CI toolchain (kubectl/argocd/gh). We CONSUME the control plane
 * (kubectl against the kind cluster continuum brought up), we don't reimplement it.
 */
import { spawn } from 'node:child_process'

export interface ArgoApp { name: string; namespace: string; sync: string; health: string }
export interface PipelineStatus {
  gitops: { kubectl: boolean; argocd: boolean }
  ci: { gh: boolean }
  apps: ArgoApp[]
  note?: string
}

function which(bin: string): Promise<boolean> {
  return new Promise((r) => { const c = spawn('sh', ['-c', `command -v ${bin}`]); c.on('close', (code) => r(code === 0)); c.on('error', () => r(false)) })
}
function capture(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((r) => { const c = spawn(cmd, args); let s = ''; c.stdout.on('data', (d: Buffer) => { s += d.toString() }); c.on('error', () => r({ code: -1, stdout: s })); c.on('close', (code) => r({ code: code ?? -1, stdout: s })) })
}

/** Parse `kubectl get applications -n argocd -o json` → ArgoApp[]. */
export function parseArgoApps(json: string): ArgoApp[] {
  try {
    const d = JSON.parse(json) as { items?: Array<Record<string, unknown>> }
    return (d.items ?? []).map((a) => {
      const meta = a.metadata as { name?: string } | undefined
      const spec = a.spec as { destination?: { namespace?: string } } | undefined
      const status = a.status as { sync?: { status?: string }; health?: { status?: string } } | undefined
      return {
        name: meta?.name ?? '',
        namespace: spec?.destination?.namespace ?? '',
        sync: status?.sync?.status ?? 'Unknown',
        health: status?.health?.status ?? 'Unknown',
      }
    })
  } catch { return [] }
}

export async function pipelineStatus(): Promise<PipelineStatus> {
  const [kubectl, gh] = await Promise.all([which('kubectl'), which('gh')])
  const out: PipelineStatus = { gitops: { kubectl, argocd: false }, ci: { gh }, apps: [] }
  if (!kubectl) { out.note = 'kubectl not installed — GitOps status unavailable'; return out }
  const ns = await capture('kubectl', ['get', 'ns', 'argocd', '-o', 'name'])
  out.gitops.argocd = ns.code === 0
  if (!out.gitops.argocd) { out.note = 'Argo CD not installed (run make dev-up in continuum)'; return out }
  const apps = await capture('kubectl', ['get', 'applications', '-n', 'argocd', '-o', 'json'])
  if (apps.code === 0) out.apps = parseArgoApps(apps.stdout)
  else out.note = 'Argo Application CRD not reachable'
  return out
}
