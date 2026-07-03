/**
 * continuum-deploy.ts — drive the SourceOS Continuum local-PaaS control plane from Noetica.
 *
 * The Workstation → Deploy surface's buttons shell out to the rehomed Porter control plane
 * (`make -f Makefile.porter <target>` in the sourceos-continuum repo):
 *   dev-up    → scripts/dev_up.sh  (kind + ingress + Argo + Cloud Shell + porter-shim)
 *   dev-down  → scripts/dev_down.sh
 *   shim-test → go vet + go test on the porter-shim (needs only Go — a no-cluster proof)
 * Output is streamed line-by-line as SSE so the surface shows a live console.
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export type Emit = (event: string, data: Record<string, unknown>) => void

/** Only these make targets may be invoked (no arbitrary target injection). */
export const DEPLOY_TARGETS = ['dev-up', 'dev-down', 'shim-test'] as const
export type DeployTarget = (typeof DEPLOY_TARGETS)[number]

/** Where the sourceos-continuum repo lives (override with SOURCEOS_CONTINUUM_PATH). */
export function continuumPath(): string {
  return process.env.SOURCEOS_CONTINUUM_PATH || path.join(os.homedir(), 'dev', 'sourceos-continuum')
}

function has(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn('sh', ['-c', `command -v ${bin}`])
    c.on('close', (code) => resolve(code === 0))
    c.on('error', () => resolve(false))
  })
}

function capture(cmd: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, cwd ? { cwd } : {})
    let stdout = ''
    c.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    c.on('error', () => resolve({ code: -1, stdout }))
    c.on('close', (code) => resolve({ code: code ?? -1, stdout }))
  })
}

export interface DeployStatus {
  continuumPath: string
  hasRepo: boolean
  runtime: { kind: boolean; podman: boolean; docker: boolean; go: boolean; kubectl: boolean; make: boolean }
  clusterUp: boolean
  clusters: string[]
  ready: boolean            // enough present to attempt dev-up
  notes: string[]
}

export async function deployStatus(): Promise<DeployStatus> {
  const cp = continuumPath()
  const hasRepo = await fs.stat(path.join(cp, 'Makefile.porter')).then((s) => s.isFile()).catch(() => false)
  const [kind, podman, docker, go, kubectl, make] = await Promise.all(
    ['kind', 'podman', 'docker', 'go', 'kubectl', 'make'].map(has),
  )
  let clusterUp = false
  let clusters: string[] = []
  if (kind) {
    const out = await capture('kind', ['get', 'clusters'])
    clusters = out.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !/no kind clusters/i.test(l))
    clusterUp = clusters.length > 0
  }
  const notes: string[] = []
  if (!hasRepo) notes.push(`continuum repo not found at ${cp} (set SOURCEOS_CONTINUUM_PATH)`)
  if (!make) notes.push('`make` not on PATH')
  if (!kind) notes.push('`kind` not installed — needed for dev-up')
  if (!podman && !docker) notes.push('no container runtime (podman/docker) — needed for dev-up')
  const ready = hasRepo && make && kind && (podman || docker)
  return { continuumPath: cp, hasRepo, runtime: { kind, podman, docker, go, kubectl, make }, clusterUp, clusters, ready, notes }
}

/** Run one allow-listed make target, streaming each output line as an SSE `log` event. */
export function runDeploy(target: string, emit: Emit): Promise<void> {
  return new Promise((resolve) => {
    if (!(DEPLOY_TARGETS as readonly string[]).includes(target)) {
      emit('error', { error: `unknown target: ${target}` }); emit('exit', { code: -1 }); resolve(); return
    }
    const cp = continuumPath()
    void fs.stat(path.join(cp, 'Makefile.porter')).then((s) => {
      if (!s.isFile()) throw new Error('no Makefile.porter')
      emit('log', { line: `$ make -f Makefile.porter ${target}   (cwd: ${cp})` })
      const child = spawn('make', ['-f', 'Makefile.porter', target], { cwd: cp, env: { ...process.env } })
      const pipe = (buf: Buffer, stream: 'out' | 'err') => {
        for (const line of buf.toString().split('\n')) if (line.length) emit('log', { line, stream })
      }
      child.stdout.on('data', (b: Buffer) => pipe(b, 'out'))
      child.stderr.on('data', (b: Buffer) => pipe(b, 'err'))
      child.on('error', (e) => { emit('log', { line: `spawn error: ${e.message}`, stream: 'err' }); emit('exit', { code: -1 }); resolve() })
      child.on('close', (code) => { emit('exit', { code: code ?? -1 }); resolve() })
    }).catch((e: unknown) => {
      emit('error', { error: `continuum repo not usable at ${cp}: ${e instanceof Error ? e.message : 'unknown'}` })
      emit('exit', { code: -1 }); resolve()
    })
  })
}
