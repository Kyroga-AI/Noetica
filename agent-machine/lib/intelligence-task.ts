/**
 * intelligence-task — named, policy-governed intelligence tasks for deliberate, auditable agent runs.
 *
 * An IntelligenceTask is the governance wrapper for a purposeful agent operation:
 *   - Named objective set BEFORE the agent runs (e.g. "GYG Like-for-Like Signal")
 *   - Policy gate enforced pre-run: confidence threshold, source allow-list, change-detection
 *   - Evidence chain logged AS the agent runs: what it saw, what it concluded, what it flagged
 *   - Governance trail AFTER: who ran it, what policy, output hash, replay reference
 *
 * This is the backend for the IFM Investors demo Steps 3–7:
 *   Step 3 → createTask()           Named task + governance intent
 *   Step 4 → policy gate (inline)   Policy set before agent moves
 *   Step 5 → addEvidence()          Evidence logged with policy enforcement
 *   Step 6 → task.evidence[]        Replay-ready reasoning log
 *   Step 7 → task.governance        ASIC-defensible audit trail
 *
 * Backed by HellGraph: tasks and evidence steps are proper graph atoms visible in the
 * Knowledge lens and queryable via graph analytics.
 */
import { getHellGraph } from '@socioprophet/hellgraph'
import * as crypto from 'node:crypto'

export interface TaskPolicy {
  confidence_threshold: number      // 0–1; evidence steps below this are flagged
  allowed_sources: string[]         // source URL prefix allow-list (empty = all)
  flag_on_source_change: boolean    // flag if the data source URL changes mid-run
  flag_on_low_confidence: boolean   // flag if any evidence step is below threshold
  owner: string                     // PM or analyst who authorised this task
}

export interface EvidenceStep {
  id: string
  task_id: string
  timestamp: string
  source_url: string
  observation: string               // what the agent saw (human-readable)
  confidence: number                // 0–1
  flagged: boolean                  // true if policy gate was triggered
  flag_reason?: string              // why it was flagged
  agent_reasoning: string           // WHY the agent drew this conclusion
  /** Decision 03: causal graph annotations */
  causal_node?: string              // which node in the DAG this evidence maps to (e.g. 'FT')
  causal_node_label?: string        // human label (e.g. 'Foot Traffic Index')
  causal_dag?: string               // which pre-defined DAG ('gyg-lfl' | 'news-intel')
  causal_path?: string[]            // directed path from this node to the outcome
}

export type TaskStatus = 'draft' | 'pending' | 'running' | 'completed' | 'flagged' | 'blocked'

export interface IntelligenceTask {
  id: string
  name: string
  objective: string
  owner: string
  policy: TaskPolicy
  status: TaskStatus
  created_at: string
  started_at?: string
  completed_at?: string
  evidence: EvidenceStep[]
  output?: string                   // final intelligence output (prose)
  governance: {
    task_id: string
    ran_by: string
    ran_at?: string
    policy_ref: string              // URN of the PolicyGate node in HellGraph
    evidence_count: number
    flagged_count: number
    status: TaskStatus
    output_hash?: string            // sha256[:16] of output for tamper detection
    replay_ref?: string             // URN for replay lookup
    /** Decision 03: causal identification certificate in the governance trail */
    causal_model?: string           // 'gyg-lfl' | 'news-intel' | null
    identification_strategy?: string // 'iv' | 'backdoor' | 'frontdoor' | 'unidentified'
    causal_summary?: string         // human-readable identification argument for ASIC
  }
}

function newId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function sha256short(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function persistTask(task: IntelligenceTask): void {
  const g = getHellGraph()
  const now = new Date().toISOString()
  const taskUrn = `urn:noetica:task:${task.id}`
  const policyUrn = `urn:noetica:task:${task.id}:policy`
  try {
    g.addNode(taskUrn, ['IntelligenceTask'], {
      name: task.name, surface: task.name, objective: task.objective,
      owner: task.owner, status: task.status, created_at: task.created_at,
    })
  } catch { /* already exists */ }
  try {
    g.addNode(policyUrn, ['PolicyGate'], {
      name: `Policy: ${task.name}`, surface: `policy:${task.id}`,
      confidence_threshold: task.policy.confidence_threshold,
      flag_on_source_change: task.policy.flag_on_source_change,
      flag_on_low_confidence: task.policy.flag_on_low_confidence,
      allowed_sources: task.policy.allowed_sources.join(','),
      owner: task.policy.owner, created_at: now,
    })
    g.addEdge('GOVERNED_BY', taskUrn, policyUrn, { kind: 'intelligence-task' })
  } catch { /* */ }
}

function persistEvidence(step: EvidenceStep): void {
  const g = getHellGraph()
  const now = new Date().toISOString()
  const stepUrn = `urn:noetica:evidence:${step.id}`
  const taskUrn = `urn:noetica:task:${step.task_id}`
  try {
    g.addNode(stepUrn, ['EvidenceStep'], {
      name: step.observation.slice(0, 80), surface: `evidence:${step.id}`,
      source_url: step.source_url, confidence: step.confidence,
      flagged: step.flagged, flag_reason: step.flag_reason ?? '',
      timestamp: step.timestamp, agent_reasoning: step.agent_reasoning,
      created_at: now,
    })
    g.addEdge('HAS_EVIDENCE', taskUrn, stepUrn, { kind: 'evidence-chain' })
  } catch { /* */ }
}

// In-process store — survives the request cycle; HellGraph provides durable graph provenance.
const TASKS = new Map<string, IntelligenceTask>()

/** Create a new named IntelligenceTask with an associated PolicyGate. */
export function createTask(params: {
  name: string
  objective: string
  owner: string
  policy?: Partial<TaskPolicy>
}): IntelligenceTask {
  const id = newId()
  const now = new Date().toISOString()
  const policy: TaskPolicy = {
    confidence_threshold: params.policy?.confidence_threshold ?? 0.70,
    allowed_sources: params.policy?.allowed_sources ?? [],
    flag_on_source_change: params.policy?.flag_on_source_change ?? true,
    flag_on_low_confidence: params.policy?.flag_on_low_confidence ?? true,
    owner: params.owner,
  }
  const task: IntelligenceTask = {
    id, name: params.name, objective: params.objective, owner: params.owner,
    policy, status: 'draft', created_at: now, evidence: [],
    governance: {
      task_id: id, ran_by: params.owner,
      policy_ref: `urn:noetica:task:${id}:policy`,
      evidence_count: 0, flagged_count: 0, status: 'draft',
    },
  }
  TASKS.set(id, task)
  persistTask(task)
  return task
}

export function getTask(id: string): IntelligenceTask | undefined {
  return TASKS.get(id)
}

export function listTasks(): IntelligenceTask[] {
  return [...TASKS.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function startTask(taskId: string): IntelligenceTask {
  const task = TASKS.get(taskId)
  if (!task) throw new Error(`task ${taskId} not found`)
  task.status = 'running'
  task.started_at = new Date().toISOString()
  task.governance.status = 'running'
  return task
}

/** Add an evidence step to a running task — policy gate is enforced here. */
export function addEvidence(
  taskId: string,
  params: {
    source_url: string
    observation: string
    confidence: number
    agent_reasoning: string
    /** Decision 03: optional causal annotations */
    causal_node?: string
    causal_node_label?: string
    causal_dag?: string
    causal_path?: string[]
  }
): EvidenceStep {
  const task = TASKS.get(taskId)
  if (!task) throw new Error(`task ${taskId} not found`)
  if (task.status === 'draft') { task.status = 'running'; task.started_at = new Date().toISOString() }

  const step: EvidenceStep = {
    id: newId(), task_id: taskId,
    timestamp: new Date().toISOString(),
    source_url: params.source_url,
    observation: params.observation,
    confidence: params.confidence,
    flagged: false,
    agent_reasoning: params.agent_reasoning,
    causal_node: params.causal_node,
    causal_node_label: params.causal_node_label,
    causal_dag: params.causal_dag,
    causal_path: params.causal_path,
  }

  // --- Policy gate enforcement ---
  const reasons: string[] = []

  if (task.policy.flag_on_low_confidence && params.confidence < task.policy.confidence_threshold) {
    reasons.push(`confidence ${params.confidence.toFixed(2)} below threshold ${task.policy.confidence_threshold.toFixed(2)}`)
  }

  if (task.policy.flag_on_source_change && task.evidence.length > 0) {
    const lastUrl = task.evidence[task.evidence.length - 1]?.source_url
    if (lastUrl && lastUrl !== params.source_url) {
      reasons.push(`data source changed (was: ${lastUrl}, now: ${params.source_url})`)
    }
  }

  if (task.policy.allowed_sources.length > 0) {
    const allowed = task.policy.allowed_sources.some((s) => params.source_url.startsWith(s))
    if (!allowed) {
      reasons.push(`source "${params.source_url}" not in allowed-source list`)
    }
  }

  if (reasons.length > 0) {
    step.flagged = true
    step.flag_reason = reasons.join('; ')
    if (task.status === 'running') task.status = 'flagged'
  }

  task.evidence.push(step)
  task.governance.evidence_count = task.evidence.length
  task.governance.flagged_count = task.evidence.filter((e) => e.flagged).length
  task.governance.status = task.status

  persistEvidence(step)
  return step
}

/** Complete a task and seal the governance trail with causal certificate. */
export function completeTask(
  taskId: string,
  output: string,
  causal?: { model: string; strategy: string; summary: string },
): IntelligenceTask {
  const task = TASKS.get(taskId)
  if (!task) throw new Error(`task ${taskId} not found`)
  const now = new Date().toISOString()
  task.output = output
  task.completed_at = now
  if (task.status === 'running' || task.status === 'flagged') task.status = 'completed'
  task.governance.status = task.status
  task.governance.ran_at = now
  task.governance.output_hash = sha256short(output)
  task.governance.replay_ref = `urn:noetica:replay:${task.id}`
  if (causal) {
    task.governance.causal_model = causal.model
    task.governance.identification_strategy = causal.strategy
    task.governance.causal_summary = causal.summary
  }
  return task
}

/** Block a task (policy gate hard-stop — agent must not continue). */
export function blockTask(taskId: string, reason: string): IntelligenceTask {
  const task = TASKS.get(taskId)
  if (!task) throw new Error(`task ${taskId} not found`)
  task.status = 'blocked'
  task.output = `BLOCKED: ${reason}`
  task.governance.status = 'blocked'
  return task
}
