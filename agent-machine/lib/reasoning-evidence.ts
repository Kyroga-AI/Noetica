/**
 * reasoning-evidence — emit spec-conformant SourceOS reasoning contracts
 * (ReasoningRun / ReasoningEvent / ReasoningReceipt) for each dialogue turn, so the
 * agent-machine's answers carry cryptographic, replayable attestation on the SAME
 * canonical contracts TurtleTerm speaks. This UNIFIES Noetica with TurtleTerm on the
 * SourceOS reasoning schemas.
 *
 * Crucially it distinguishes COMPUTED/verifiable answers — deterministic, replayClass
 * "exact" (logic-solver decided, CAS-computed, extractive verbatim, recall/crystallized
 * artifact) — from GENERATED answers — replayClass "best-effort" (LLM generation).
 *
 * This COMPLEMENTS the dispatch-ledger (the SEAM-C hash chain) and crystallize artifacts:
 * the receipt REFERENCES the ledger attestation / crystallized artifact where one exists,
 * rather than re-deriving its own integrity spine.
 *
 * Safe-trace rule: events carry SHORT SUMMARIES ONLY — never raw model output or private
 * reasoning content. Obvious secrets are redacted from summaries. Every function is
 * exception-safe: a fs/schema hiccup must NEVER break a dialogue turn (wrap, warn, continue).
 *
 * Authority: /Users/michaelheller/dev/sourceos-spec/schemas/{ReasoningRun,ReasoningEvent,ReasoningReceipt}.json
 * Dependency-light: node crypto + fs only, no new npm deps.
 */
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SPEC_VERSION = '2.0.0'
const RUN_PREFIX = 'urn:srcos:reasoning-run:'
const EVENT_PREFIX = 'urn:srcos:reasoning-event:'
const RECEIPT_PREFIX = 'urn:srcos:receipt:reasoning:'
const TASK_PREFIX = 'urn:srcos:reasoning-task:'
const AGENT_REF = 'urn:srcos:agent:noetica-agent-machine'
const WORKSPACE_REF = 'urn:srcos:workspace:noetica'

export type ReplayClass = 'exact' | 'best-effort' | 'evidence-only' | 'non-replayable-side-effect'
export type ReceiptStatus = 'completed' | 'failed' | 'blocked' | 'cancelled'
export type TraceLevel = 'public-safe' | 'workspace-safe' | 'operator-private' | 'restricted'
export type TrustLevel =
  | 'trusted-control-input' | 'trusted-workspace-source' | 'semi-trusted-project-source'
  | 'untrusted-observation' | 'restricted-material'

export interface ReasoningTask { id: string; title: string; objectiveHash?: string }
export interface SafeTrace { mode: 'operational-trace-only'; rawPrivateReasoning: 'not-collected'; eventCount: number }

export interface ReasoningRun {
  id: string
  type: 'ReasoningRun'
  specVersion: string
  status: string
  task: ReasoningTask
  agentRef: string
  workspaceRef: string
  safeTrace: SafeTrace
  eventRefs: string[]
  artifactRefs: string[]
  startedAt: string
  completedAt?: string
  // bookkeeping (additionalProperties allowed by the schema)
  _runHex: string
}

export interface ReasoningEvent {
  id: string
  type: 'ReasoningEvent'
  specVersion: string
  runRef: string
  eventType: string
  summary: string
  traceLevel: TraceLevel
  trustLevel: TrustLevel
  capturedAt: string
  [k: string]: unknown
}

export interface ReasoningReceipt {
  id: string
  type: 'ReasoningReceipt'
  specVersion: string
  runRef: string
  taskRef: string
  status: ReceiptStatus
  traceHash: string
  replayClass: ReplayClass
  capturedAt: string
  [k: string]: unknown
}

function sink(): string {
  return process.env.SOURCEOS_REASONING_EVIDENCE || join(homedir(), '.noetica', 'reasoning')
}
function eventsLog(): string { return join(sink(), 'reasoning-events.ndjson') }
function hex(bytes = 16): string { return randomBytes(bytes).toString('hex') }
function sha256(s: string): string { return createHash('sha256').update(s).digest('hex') }
function nowIso(): string { return new Date().toISOString() }

/** Strip obvious secrets from a short summary string. Safe-trace hygiene. */
function redact(s: string): string {
  let out = String(s ?? '')
  // Bearer / API-key shapes, sk- / ghp_ tokens, long hex blobs, AWS keys, JWTs.
  out = out.replace(/\b(sk|ghp|gho|ghu|ghs|ghr|xox[baprs])[-_][A-Za-z0-9._-]{8,}\b/g, '[redacted]')
  out = out.replace(/\bAKIA[0-9A-Z]{12,}\b/g, '[redacted]')
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  out = out.replace(/\b[A-Fa-f0-9]{40,}\b/g, '[redacted]')
  out = out.replace(/\b(bearer|authorization|api[_-]?key|token|password|secret)\b\s*[:=]?\s*\S+/gi, '$1 [redacted]')
  return out.slice(0, 500)
}

/** Open a conformant ReasoningRun in status "running". Exception-safe. */
export function openReasoningRun(taskTitle: string, opts?: { objectiveHash?: string }): ReasoningRun {
  const runHex = hex()
  const run: ReasoningRun = {
    id: RUN_PREFIX + runHex,
    type: 'ReasoningRun',
    specVersion: SPEC_VERSION,
    status: 'running',
    task: { id: TASK_PREFIX + hex(8), title: String(taskTitle ?? '').slice(0, 300) || 'turn', ...(opts?.objectiveHash ? { objectiveHash: opts.objectiveHash } : {}) },
    agentRef: AGENT_REF,
    workspaceRef: WORKSPACE_REF,
    safeTrace: { mode: 'operational-trace-only', rawPrivateReasoning: 'not-collected', eventCount: 0 },
    eventRefs: [],
    artifactRefs: [],
    startedAt: nowIso(),
    _runHex: runHex,
  }
  return run
}

/** Emit a conformant ReasoningEvent: append NDJSON to the streaming sink, push id to
 *  run.eventRefs, bump safeTrace.eventCount. Returns the event id (or '' on failure).
 *  SUMMARY ONLY — never raw model output. */
export function emitReasoningEvent(
  run: ReasoningRun,
  args: { eventType: string; summary: string; trustLevel: TrustLevel; traceLevel?: TraceLevel; extra?: Record<string, unknown> },
): string {
  try {
    const id = EVENT_PREFIX + hex()
    const event: ReasoningEvent = {
      id,
      type: 'ReasoningEvent',
      specVersion: SPEC_VERSION,
      runRef: run.id,
      eventType: String(args.eventType ?? 'noetica.event'),
      summary: redact(args.summary),
      traceLevel: args.traceLevel ?? 'workspace-safe',
      trustLevel: args.trustLevel,
      capturedAt: nowIso(),
      ...(args.extra ?? {}),
    }
    mkdirSync(sink(), { recursive: true })
    appendFileSync(eventsLog(), JSON.stringify(event) + '\n')
    run.eventRefs.push(id)
    run.safeTrace.eventCount = run.eventRefs.length
    return id
  } catch (err) {
    console.warn('[reasoning-evidence] emitReasoningEvent failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

/** Close the run: write run.json + receipt.json under <sink>/<runHex>/. traceHash =
 *  "sha256:" + sha256(joined event ids). References the dispatch-ledger attestation /
 *  crystallized artifact when present. Returns the receipt (or a best-effort stub on failure). */
export function closeReasoningRun(
  run: ReasoningRun,
  args: { status: ReceiptStatus; replayClass: ReplayClass; taskRef?: string; ledgerRef?: string; coordination?: Record<string, unknown> },
): ReasoningReceipt {
  const traceHash = 'sha256:' + sha256(run.eventRefs.join('|'))
  const receipt: ReasoningReceipt = {
    id: RECEIPT_PREFIX + run._runHex,
    type: 'ReasoningReceipt',
    specVersion: SPEC_VERSION,
    runRef: run.id,
    taskRef: args.taskRef ?? run.task.id,
    status: args.status,
    traceHash,
    replayClass: args.replayClass,
    capturedAt: nowIso(),
    ...(args.coordination ? { coordination: args.coordination } : {}),
  }
  // Reference the ledger/crystallize attestation rather than duplicating it.
  if (args.ledgerRef) {
    receipt.ledgerRef = args.ledgerRef
    if (!run.artifactRefs.includes(args.ledgerRef)) run.artifactRefs.push(args.ledgerRef)
  }
  try {
    run.status = args.status === 'completed' ? 'completed' : args.status === 'failed' ? 'failed' : args.status === 'blocked' ? 'blocked' : 'cancelled'
    run.completedAt = receipt.capturedAt
    const dir = join(sink(), run._runHex)
    mkdirSync(dir, { recursive: true })
    // Persist the run WITHOUT the private bookkeeping field.
    const { _runHex, ...runOut } = run
    writeFileSync(join(dir, 'run.json'), JSON.stringify(runOut, null, 2))
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2))
  } catch (err) {
    console.warn('[reasoning-evidence] closeReasoningRun failed:', err instanceof Error ? err.message : String(err))
  }
  return receipt
}

// ─── Agentic-surface evidence: tool calls + dispatched sub-agents ──────────────
// These bring the most "agentic" parts of Noetica — tool execution and sub-agent
// dispatch — under the SAME governance fabric as dialogue turns. All helpers are
// safe-trace (short summaries only, never raw tool args/output or sub-agent prompts)
// and exception-safe: an evidence failure must NEVER break a tool call or a dispatch.

/** Ambient run pointer: when the turn handler holds a run open across the tool loop,
 *  tool-call events thread onto it. Today turn-runs are written post-hoc, so this is
 *  usually unset and the tool helper opens a lightweight per-call run instead. */
let _currentRun: ReasoningRun | null = null
export function setCurrentReasoningRun(run: ReasoningRun | null): void { _currentRun = run }
export function getCurrentReasoningRun(): ReasoningRun | null { return _currentRun }

/** Tools whose effects mutate external state (exec / fs-write / memory-write / dispatch)
 *  ⇒ replayClass "non-replayable-side-effect". Everything else (reads, net lookups) is
 *  observational ⇒ "evidence-only". Kept in sync with server.ts TOOL_CAP/ACTION_CLASS. */
const SIDE_EFFECT_TOOLS = new Set([
  'run_command', 'code_execute', 'write_file', 'edit_file', 'remember',
  'update_self', 'generate_image', 'dispatch_agent',
])
function toolReplayClass(toolName: string): ReplayClass {
  return SIDE_EFFECT_TOOLS.has(toolName) ? 'non-replayable-side-effect' : 'evidence-only'
}

/** Emit a conformant ReasoningEvent for ONE tool call. eventType = `tool.<toolName>`;
 *  summary is a SHORT safe description ("called tool X") — NEVER tool args/output.
 *  Threads onto the ambient run if one is open; otherwise opens a lightweight run for
 *  this tool call and closes it with a receipt (replayClass per side-effect class).
 *  Fully exception-safe — returns the event id or '' and never throws. */
export function emitToolCallEvidence(
  toolName: string,
  opts?: { detail?: string; userInitiated?: boolean; status?: ReceiptStatus },
): string {
  try {
    const tool = String(toolName ?? 'unknown').slice(0, 80)
    // user-initiated tool actions are control input; sub-agent/internal ones are project-source.
    const trustLevel: TrustLevel = opts?.userInitiated === false
      ? 'semi-trusted-project-source' : 'trusted-control-input'
    const summary = `called tool ${tool}${opts?.detail ? ` (${opts.detail})` : ''}`
    const ambient = _currentRun
    if (ambient) {
      return emitReasoningEvent(ambient, { eventType: `tool.${tool}`, summary, trustLevel })
    }
    // No open turn-run: a lightweight self-contained run for this single tool call.
    const run = openReasoningRun(`tool:${tool}`)
    const id = emitReasoningEvent(run, { eventType: `tool.${tool}`, summary, trustLevel })
    closeReasoningRun(run, { status: opts?.status ?? 'completed', replayClass: toolReplayClass(tool) })
    return id
  } catch (err) {
    console.warn('[reasoning-evidence] emitToolCallEvidence failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

/** Open a CHILD ReasoningRun for a dispatched sub-agent, linked to the parent run, and
 *  emit a `subagent.dispatch` event on the parent. Returns the child run (or null on
 *  failure). The parent link rides in the child task (parentRunRef — schema allows
 *  additionalProperties) AND in artifactRefs. Safe-trace: only the role + a short task
 *  label, never the full sub-agent prompt. Exception-safe. */
export function openSubAgentRun(
  role: string,
  taskLabel: string,
  parent?: ReasoningRun | null,
): ReasoningRun | null {
  try {
    const r = String(role ?? 'agent').slice(0, 60)
    const child = openReasoningRun(`subagent:${r}: ${String(taskLabel ?? '').slice(0, 120)}`)
    const parentRun = parent ?? _currentRun
    if (parentRun) {
      // Link child → parent both on the task and as an artifact ref the schema permits.
      ;(child.task as ReasoningTask & { parentRunRef?: string }).parentRunRef = parentRun.id
      if (!child.artifactRefs.includes(parentRun.id)) child.artifactRefs.push(parentRun.id)
      emitReasoningEvent(parentRun, {
        eventType: 'subagent.dispatch',
        summary: `dispatched sub-agent role=${r}`,
        trustLevel: 'trusted-control-input',
        extra: { childRunRef: child.id },
      })
    }
    return child
  } catch (err) {
    console.warn('[reasoning-evidence] openSubAgentRun failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/** Close a sub-agent CHILD run with a receipt. Sub-agents GENERATE ⇒ replayClass
 *  "best-effort" by default. Exception-safe; tolerates a null child (no-op). */
export function closeSubAgentRun(
  child: ReasoningRun | null,
  args?: { status?: ReceiptStatus; replayClass?: ReplayClass },
): void {
  if (!child) return
  try {
    closeReasoningRun(child, {
      status: args?.status ?? 'completed',
      replayClass: args?.replayClass ?? 'best-effort',
    })
  } catch (err) {
    console.warn('[reasoning-evidence] closeSubAgentRun failed:', err instanceof Error ? err.message : String(err))
  }
}

/** Distinguish COMPUTED/verifiable (deterministic ⇒ "exact") from GENERATED (LLM ⇒
 *  "best-effort"). The signal: the turn's method/source — recall, compute, extractive,
 *  and crystallized/recalled artifacts are deterministic and replay exactly; everything
 *  else (LLM generation) is best-effort. Accepts whatever the turn carries (method,
 *  model_routed, stop_reason, or an explicit decidable flag). */
export function classifyReplay(turn: {
  method?: string | null
  model?: string | null
  model_routed?: string | null
  stop_reason?: string | null
  decidable?: boolean | null
  computed?: boolean | null
}): 'exact' | 'best-effort' {
  if (turn.decidable === true || turn.computed === true) return 'exact'
  const deterministic = new Set(['recall', 'compute', 'extract', 'extractive'])
  const m = String(turn.method ?? turn.model ?? turn.model_routed ?? '').toLowerCase()
  if (deterministic.has(m)) return 'exact'
  const sr = String(turn.stop_reason ?? '').toLowerCase()
  if (sr === 'computed' || sr === 'extractive') return 'exact'
  return 'best-effort'
}
