/**
 * operator-cli.ts — the Workstation Terminal surface's backend: run the canonical operator CLIs
 * (prophet-cli / sourceos-devtools' sourceosctl) as an allow-listed, injection-safe command runner,
 * streaming output as SSE. We CONSUME the installed binaries (they're the operator-parity surface),
 * we don't reimplement them. No shell is used and every arg is validated, so this can never run an
 * arbitrary command — only an allow-listed subcommand of an allow-listed tool.
 */
import { spawn } from 'node:child_process'

export type OperatorTool = 'prophet' | 'sourceosctl'

export const OPERATOR_ALLOW: Record<OperatorTool, { bin: string; subcommands: string[] }> = {
  prophet: {
    bin: process.env.PROPHET_CLI_BIN || 'prophet',
    subcommands: ['infra', 'kustomize', 'workspace', '--help', '--version'],
  },
  sourceosctl: {
    bin: process.env.SOURCEOSCTL_BIN || 'sourceosctl',
    subcommands: ['profile', 'doctor', 'lab', 'run', 'nlboot', 'office', 'model', '--help', '--version'],
  },
}

export type Emit = (event: string, data: Record<string, unknown>) => void

// args may only contain word chars + a few path/flag-safe symbols — no shell metacharacters.
const SAFE_ARG = /^[\w.@/:=+-]+$/

function has(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn('sh', ['-c', `command -v ${bin.replace(/[^\w./-]/g, '')}`])
    c.on('close', (code) => resolve(code === 0))
    c.on('error', () => resolve(false))
  })
}

export interface OperatorStatus {
  tools: Record<OperatorTool, { bin: string; installed: boolean; subcommands: string[] }>
}

export async function operatorStatus(): Promise<OperatorStatus> {
  const tools = {} as OperatorStatus['tools']
  for (const t of Object.keys(OPERATOR_ALLOW) as OperatorTool[]) {
    const cfg = OPERATOR_ALLOW[t]
    tools[t] = { bin: cfg.bin, installed: await has(cfg.bin), subcommands: cfg.subcommands }
  }
  return { tools }
}

/** Validate an operator invocation without running it (used by tests + the route guard). */
export function validateInvocation(tool: string, args: string[]): { ok: true } | { ok: false; error: string } {
  const cfg = OPERATOR_ALLOW[tool as OperatorTool]
  if (!cfg) return { ok: false, error: `tool not allowed: ${tool}` }
  if (args.length === 0) return { ok: false, error: 'no subcommand' }
  if (!cfg.subcommands.includes(args[0])) return { ok: false, error: `subcommand not allowed: ${args[0]}` }
  const bad = args.find((a) => !SAFE_ARG.test(a))
  if (bad) return { ok: false, error: `unsafe argument: ${bad}` }
  return { ok: true }
}

/** Run an allow-listed operator command (no shell), streaming each line as an SSE `log` event. */
export function runOperator(tool: string, args: string[], emit: Emit): Promise<void> {
  return new Promise((resolve) => {
    const check = validateInvocation(tool, args)
    if (!check.ok) { emit('error', { error: check.error }); emit('exit', { code: -1 }); resolve(); return }
    const cfg = OPERATOR_ALLOW[tool as OperatorTool]
    emit('log', { line: `$ ${tool} ${args.join(' ')}` })
    const child = spawn(cfg.bin, args, { env: { ...process.env } }) // array args, no shell → no injection
    const pipe = (buf: Buffer, stream: 'out' | 'err') => { for (const line of buf.toString().split('\n')) if (line.length) emit('log', { line, stream }) }
    child.stdout.on('data', (b: Buffer) => pipe(b, 'out'))
    child.stderr.on('data', (b: Buffer) => pipe(b, 'err'))
    child.on('error', (e) => { emit('log', { line: `spawn error: ${e.message}`, stream: 'err' }); emit('exit', { code: -1 }); resolve() })
    child.on('close', (code) => { emit('exit', { code: code ?? -1 }); resolve() })
  })
}
