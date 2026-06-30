import type { GovernanceTrace } from '@/lib/types/governance'
import type { SteeringResult } from '@/lib/types/steering'
import type { PendingAttachment } from '@/lib/types/attachment'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ToolCallRecord {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultRecord {
  id: string
  name: string
  result: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  created_at: string
  workspace_mode?: string
  thinking?: string
  fanout_model?: string
  governance?: GovernanceTrace
  steering_result?: SteeringResult
  attachments?: PendingAttachment[]
  /** Tool calls the model requested during this turn */
  tool_calls?: ToolCallRecord[]
  /** Results returned to the model for each tool call */
  tool_results?: ToolResultRecord[]
  /** True when the user cancelled generation mid-stream */
  stopped?: boolean
  /** Neurosymbolic retrieval trace — why this answer was grounded the way it was */
  retrieval_trace?: RetrievalTrace
  /** Value Judgment — explicit 4D/RCS-style scoring of the answer vs the world model */
  value_judgment?: ValueJudgment
  /** Deliberation scoreboard — candidates generated and scored before selection */
  deliberation?: Deliberation
  /** Structured intent the turn was classified as (22-intent router) */
  intent?: IntentTrace
  /** Live plan + execution timeline streamed as the turn runs */
  plan?: ExecutionPlan
  /** Glossary-grounded NLU: domain + topics + terms recognized in the turn */
  grounding?: GroundingTrace
  /** The announcer's plain-language narration of what the agent is doing, per stage */
  narration?: NarrationLine[]
  /** Local dialogue-layer quick replies — clickable suggestions that send their text. */
  quick_replies?: string[]
  /** Build clarifier — a deterministic multiple-choice card that scaffolds + runs a project. */
  build?: BuildSpec
  /** Verification badge — HOW this answer was proven (computed / reasoned / generated), the moat made visible. */
  verification?: VerificationInfo
  /** Inline citations — the numbered sources this answer is grounded in (Onyx/NotebookLM-grade). */
  citations?: Citation[]
}

/** Verification provenance for an answer — emitted by agent-machine's reasoning-evidence layer. */
export interface VerificationInfo {
  /** True when the answer is a deterministic, replay-exact computation (operator lane). */
  computed: boolean
  /** Replay class, e.g. 'replay-exact' | 'best-effort'. */
  replayClass: string
  /** How the answer was produced, e.g. 'operator' | 'self-consistency' | 'reason-lane' | 'generated'. */
  method: string
  /** True when the run is attested (sealed onto the evidence fabric). */
  attested: boolean
  /** Reference to the verification receipt, if any. */
  receiptRef: string | null
  /** Reference to the reasoning run, if any. */
  runRef: string | null
  /** True when the run is sealable onto the evidence spine. */
  sealable: boolean
  /** Human-readable badge, e.g. 'Computed · operator · replay-exact · attested'. */
  badge: string
}

/** One numbered citation grounding an answer. */
export interface Citation {
  /** Citation number, as referenced inline ([n]). */
  n: number
  /** Display label of the source. */
  source: string
  /** Stable reference/locator for the source. */
  ref: string
  /** Retrieval/grounding match score (0–1). */
  score: number
  /** Optional grounding status, e.g. 'grounded' | 'unverified'. */
  grounding_status?: string
}

/** A build-clarifier card: ask framework/language (no model), then deterministically scaffold. */
export interface BuildSpec {
  intro: string
  questions: { id: string; label: string; options: string[] }[]
}

/** One line of the concierge's announcer narration — which model, for what purpose. */
export interface NarrationLine {
  stage: string
  text: string
  model?: string
  purpose?: string
}

/** What the glossary lookup recognized in the turn (Rasa-style entity grounding). */
export interface GroundingTrace {
  domain: string
  topics: string[]
  terms: string[]
}

/** The classified intent + its routing plan (from the 22-intent router). */
export interface IntentTrace {
  id: number
  name: string
  capability: string
  retrieval: string
  slots: string[]
  score: number
}

export type PlanStepStatus = 'pending' | 'running' | 'done'

export interface PlanStep {
  id: string
  label: string
  status: PlanStepStatus
  detail?: string
}

/** A step status update streamed mid-turn — merged into the plan by `id`. */
export interface PlanStepUpdate {
  id: string
  status: PlanStepStatus
  detail?: string
}

/** The ordered, live-updating execution timeline for a turn. */
export interface ExecutionPlan {
  intent: string
  capability: string
  retrieval: string
  slots: string[]
  steps: PlanStep[]
  /** Product surface this intent routes to (components/surfaces/*); '' = stay put */
  surface?: string
  /** Specialist agent ("skill") that fulfills the intent; '' = concierge */
  skill?: string
  /** Builtin tools scoped to this intent */
  tools?: string[]
}

export interface Deliberation {
  candidates: Array<{
    rank: number
    worth: number
    grounding: number
    verdict: 'grounded' | 'speculative' | 'contradiction'
    temperature: number
    preview: string
  }>
  selected_rank: number
}

export interface ValueJudgment {
  worth: number
  grounding: number
  graph_grounding?: number
  novel_claims?: string[]
  belief_alignment: number
  contradictions: Array<{ kind: 'belief' | 'law'; statement: string; detail: string }>
  verdict: 'grounded' | 'speculative' | 'contradiction'
  notes: string[]
}

export interface RetrievalTrace {
  /** Retrieval patterns that contributed context (e.g. beliefs, atoms, graph) */
  patterns: string[]
  /** Per-pattern execution: which ran, how long, how many hits */
  timings: Array<{ pattern: string; durationMs: number; hits: number }>
  /** Top attention-ranked sources (atoms/edges) with their scores */
  sources: Array<{ id: string; label: string; score: number }>
  /** Estimated tokens of injected context */
  token_estimate: number
  /** How many belief snapshots were injected from the world model */
  beliefs_injected: number
  /** Uploaded-document chunks cited for this answer (semantic RAG), shown as source chips */
  document_sources?: Array<{ id: string; label: string; score: number }>
  /** Long-term memories injected this turn (provenance: what the agent "remembered") */
  memory_sources?: Array<{ kind: string; preview: string; pinned: boolean }>
  /** Prior cross-session exchanges recalled this turn */
  episode_sources?: Array<{ question: string }>
}
