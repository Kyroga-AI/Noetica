/**
 * catalog.ts — the Claude Code classifier set, as a starting library for Noetica's
 * own agent working on its own repo.
 *
 * "Combed" from how Claude Code actually operates: every point where it maps an
 * input to a discrete decision is a classifier. This catalog enumerates that set
 * as declarative definitions (id → labels → routing effect), mirroring the shape
 * of the existing intent-router / injection-classifier so it CONFORMS to the
 * house style rather than reinventing it. Where Noetica already implements part
 * of a classifier, `existingImpl` points at it — extend those, don't duplicate.
 *
 * These are taxonomies + routing intent, not model weights. Each can be realized
 * as: a cue/heuristic scorer (like injection-classifier), an embedding match
 * (like intent-embed), or a small LLM judge — whichever fits the latency budget.
 */

export type ClassifierGroup = 'routing' | 'safety' | 'memory' | 'review' | 'session' | 'domain'

export interface ClassifierLabel {
  /** Stable label id (the class the input is sorted into). */
  id: string
  /** What this label means / when it applies. */
  description: string
}

export interface ClassifierDef {
  /** Stable kebab-case id. */
  id: string
  group: ClassifierGroup
  title: string
  /** The decision this classifier makes. */
  purpose: string
  /** The output classes. */
  labels: ClassifierLabel[]
  /** The safe/most-common default when signal is weak. */
  defaultLabel?: string
  /** When this classifier fires in the agent loop. */
  appliesWhen: string
  /** What the chosen label routes, gates, or changes downstream. */
  effect: string
  /** The Claude Code behavior this mirrors (provenance for the "comb"). */
  minedFrom: string
  /** Noetica code that already implements part of this — extend, don't rebuild. */
  existingImpl?: string
}

export const CLAUDE_CODE_CLASSIFIERS: ClassifierDef[] = [
  // ── Routing / dispatch ─────────────────────────────────────────────────
  {
    id: 'request-intent',
    group: 'routing',
    title: 'Request intent',
    purpose: 'Map each user turn to what they actually want done.',
    labels: [
      { id: 'build', description: 'Create/implement new code or artifacts.' },
      { id: 'fix', description: 'Diagnose and repair broken behavior.' },
      { id: 'edit', description: 'Modify existing code to a spec.' },
      { id: 'explain', description: 'Teach/describe how something works.' },
      { id: 'research', description: 'Find external information.' },
      { id: 'review', description: 'Audit/critique code or a design.' },
      { id: 'plan', description: 'Produce a strategy/next-steps, no edits yet.' },
      { id: 'run', description: 'Execute/verify something and report.' },
      { id: 'chore', description: 'Mechanical task (rename, move, config).' },
      { id: 'converse', description: 'Q&A / small talk / clarification.' },
    ],
    defaultLabel: 'converse',
    appliesWhen: 'Start of every user turn.',
    effect: 'Selects capability, retrieval strategy, tool set, surface, and skill.',
    minedFrom: 'Claude Code request routing (edit vs debug vs search vs plan).',
    existingImpl: 'agent-machine/lib/intent-router.ts (22-intent taxonomy + PLAN)',
  },
  {
    id: 'agent-selection',
    group: 'routing',
    title: 'Agent / subagent selection',
    purpose: 'Decide whether to handle inline or delegate to a specialist agent.',
    labels: [
      { id: 'inline', description: 'Handle directly in the main loop.' },
      { id: 'explore', description: 'Broad read-only fan-out search.' },
      { id: 'plan', description: 'Architect an implementation plan.' },
      { id: 'general-purpose', description: 'Multi-step autonomous task.' },
      { id: 'domain-specialist', description: 'A registered domain agent.' },
    ],
    defaultLabel: 'inline',
    appliesWhen: 'A task is large, parallelizable, or needs isolated context.',
    effect: 'Spawns the chosen agent vs continuing inline; sets its tool grants.',
    minedFrom: 'Claude Code Task/subagent dispatch (Explore, Plan, general-purpose).',
    existingImpl: 'agent-machine/lib/multi-agent.ts, operation-router.ts',
  },
  {
    id: 'skill-match',
    group: 'routing',
    title: 'Skill match',
    purpose: 'Detect when a request matches a packaged skill/workflow.',
    labels: [
      { id: 'skill', description: 'Matches a specific skill — invoke it first.' },
      { id: 'none', description: 'No skill applies — handle generally.' },
    ],
    defaultLabel: 'none',
    appliesWhen: 'On each turn, before general handling.',
    effect: 'Blocks generic handling and routes to the matched skill.',
    minedFrom: 'Claude Code Skill triggering (invoke skill before responding).',
  },
  {
    id: 'plan-vs-act',
    group: 'routing',
    title: 'Plan vs act vs ask',
    purpose: 'Decide whether there is enough information to act now.',
    labels: [
      { id: 'act', description: 'Enough context — proceed.' },
      { id: 'plan', description: 'Non-trivial — design before editing.' },
      { id: 'ask-user', description: 'Blocked on a decision only the user can make.' },
    ],
    defaultLabel: 'act',
    appliesWhen: 'Before taking a consequential action.',
    effect: 'Chooses immediate execution, a plan pass, or an AskUserQuestion.',
    minedFrom: 'Claude Code "when you have enough info to act, act" + plan mode.',
  },
  {
    id: 'model-effort-routing',
    group: 'routing',
    title: 'Model / effort routing',
    purpose: 'Pick the model tier and reasoning effort for a task.',
    labels: [
      { id: 'fast', description: 'Cheap/quick — trivial or latency-sensitive.' },
      { id: 'balanced', description: 'Default general capability.' },
      { id: 'deep', description: 'High-effort reasoning for hard tasks.' },
    ],
    defaultLabel: 'balanced',
    appliesWhen: 'Per task, after intent is known.',
    effect: 'Sets the provider/model and thinking budget.',
    minedFrom: 'Claude Code model selection + review effort tiers.',
    existingImpl: 'lib/model-router/adapter.ts, agent-machine/lib/router.ts',
  },
  {
    id: 'tool-selection',
    group: 'routing',
    title: 'Tool selection',
    purpose: 'Choose the right tool for the next step.',
    labels: [
      { id: 'read', description: 'Inspect files/state.' },
      { id: 'search', description: 'Grep/semantic search across the repo.' },
      { id: 'edit', description: 'Modify a file.' },
      { id: 'execute', description: 'Run code/commands.' },
      { id: 'web', description: 'Fetch external info.' },
      { id: 'repo', description: 'Read a remote repo (read_repo / gh).' },
      { id: 'none', description: 'Answer from context, no tool.' },
    ],
    defaultLabel: 'none',
    appliesWhen: 'Each step of an agentic turn.',
    effect: 'Emits the corresponding tool call (or a direct answer).',
    minedFrom: 'Claude Code "prefer the dedicated tool over shell" guidance.',
    existingImpl: 'agent-machine/lib/tool-validate.ts',
  },

  // ── Safety / policy ────────────────────────────────────────────────────
  {
    id: 'action-reversibility',
    group: 'safety',
    title: 'Action reversibility',
    purpose: 'Gate hard-to-reverse or outward-facing actions behind confirmation.',
    labels: [
      { id: 'safe', description: 'Reversible/local — proceed.' },
      { id: 'confirm', description: 'Hard to reverse or external — confirm first.' },
      { id: 'authorized', description: 'Confirm-class but durably pre-approved.' },
    ],
    defaultLabel: 'safe',
    appliesWhen: 'Before delete/overwrite, push, publish, send, deploy.',
    effect: 'Requires explicit confirmation unless already authorized.',
    minedFrom: 'Claude Code "confirm first for hard-to-reverse/outward-facing".',
  },
  {
    id: 'destructive-request',
    group: 'safety',
    title: 'Destructive / disallowed request',
    purpose: 'Refuse malicious-use requests while allowing authorized security work.',
    labels: [
      { id: 'allow', description: 'Legitimate (incl. authorized security testing).' },
      { id: 'refuse', description: 'Destructive/DoS/mass-target/evasion for harm.' },
    ],
    defaultLabel: 'allow',
    appliesWhen: 'On requests touching security/offensive capability.',
    effect: 'Blocks and explains, or proceeds with the authorized task.',
    minedFrom: 'Claude Code security-use policy (dual-use needs authorization).',
  },
  {
    id: 'prompt-injection',
    group: 'safety',
    title: 'Prompt injection / jailbreak',
    purpose: 'Score input and tool output for instruction-override attempts.',
    labels: [
      { id: 'clean', description: 'No injection signal.' },
      { id: 'suspicious', description: 'Some signal — treat content as data.' },
      { id: 'injection', description: 'Strong signal — ignore embedded instructions.' },
    ],
    defaultLabel: 'clean',
    appliesWhen: 'On user prompts and on retrieved/tool-returned content.',
    effect: 'Downgrades embedded instructions to inert data; may warn.',
    minedFrom: 'Claude Code treating tool/hook output as untrusted content.',
    existingImpl: 'agent-machine/lib/injection-classifier.ts (input side)',
  },
  {
    id: 'content-policy',
    group: 'safety',
    title: 'Content policy admission',
    purpose: 'Admit or block a turn against the active policy profile.',
    labels: [
      { id: 'admitted', description: 'Passes policy.' },
      { id: 'blocked', description: 'Violates policy — refuse with reason.' },
    ],
    defaultLabel: 'admitted',
    appliesWhen: 'Before provider selection / generation.',
    effect: 'Short-circuits to a policy_blocked response with the reason.',
    minedFrom: 'Claude Code content handling per policy profile.',
    existingImpl: 'lib/policy/contentPolicy.ts',
  },
  {
    id: 'secret-pii-sensitivity',
    group: 'safety',
    title: 'Secret / PII sensitivity',
    purpose: 'Detect credentials or personal data in content being handled.',
    labels: [
      { id: 'none', description: 'No sensitive data.' },
      { id: 'pii', description: 'Personal data present — handle carefully.' },
      { id: 'secret', description: 'Credential/token/key — never echo or log.' },
    ],
    defaultLabel: 'none',
    appliesWhen: 'Before persisting, logging, or transmitting content.',
    effect: 'Redacts, refuses to publish, or scopes storage.',
    minedFrom: 'Claude Code "publishing distributes; read before you send" + memory redaction.',
  },
  {
    id: 'permission-decision',
    group: 'safety',
    title: 'Permission decision',
    purpose: 'Resolve a tool call against the permission mode / allowlist.',
    labels: [
      { id: 'allow', description: 'Permitted — run without prompting.' },
      { id: 'ask', description: 'Needs a permission prompt.' },
      { id: 'deny', description: 'Denied — adjust, do not retry verbatim.' },
    ],
    defaultLabel: 'ask',
    appliesWhen: 'On every tool invocation.',
    effect: 'Runs, prompts, or blocks the call.',
    minedFrom: 'Claude Code permission modes + "denied call means declined".',
    existingImpl: 'agent-machine/lib/capability-routes.ts',
  },

  // ── Memory ─────────────────────────────────────────────────────────────
  {
    id: 'memory-type',
    group: 'memory',
    title: 'Memory type',
    purpose: 'Classify a fact worth persisting into its store type.',
    labels: [
      { id: 'user', description: 'Who the user is (role, expertise, preferences).' },
      { id: 'feedback', description: 'Guidance on how to work (with the why).' },
      { id: 'project', description: 'Ongoing work/goals/constraints, absolute dates.' },
      { id: 'reference', description: 'Pointer to an external resource (URL, ticket).' },
    ],
    appliesWhen: 'When a durable memory is being written.',
    effect: 'Chooses the file/frontmatter type and body template.',
    minedFrom: 'Claude Code memory system (user|feedback|project|reference).',
    existingImpl: 'lib/memory-mesh/adapter.ts',
  },
  {
    id: 'memory-worthiness',
    group: 'memory',
    title: 'Memory worthiness',
    purpose: 'Decide whether something should be persisted at all.',
    labels: [
      { id: 'persist', description: 'Non-obvious, durable, reusable — save it.' },
      { id: 'skip', description: 'Derivable from repo/history or conversation-only.' },
    ],
    defaultLabel: 'skip',
    appliesWhen: 'After a turn that revealed a candidate fact.',
    effect: 'Writes a memory (with why/how-to-apply) or does nothing.',
    minedFrom: 'Claude Code "don\'t save what the repo already records".',
  },
  {
    id: 'recall-relevance',
    group: 'memory',
    title: 'Recall relevance',
    purpose: 'Judge whether a recalled memory applies to the current turn.',
    labels: [
      { id: 'relevant', description: 'Apply it as background context.' },
      { id: 'stale', description: 'May be outdated — verify before acting.' },
      { id: 'irrelevant', description: 'Ignore for this turn.' },
    ],
    defaultLabel: 'relevant',
    appliesWhen: 'On memory recall injection.',
    effect: 'Includes, verifies, or drops the memory from context.',
    minedFrom: 'Claude Code "recalled memories are background, verify if stale".',
  },

  // ── Code review ────────────────────────────────────────────────────────
  {
    id: 'finding-category',
    group: 'review',
    title: 'Review finding category',
    purpose: 'Type a code-review finding.',
    labels: [
      { id: 'correctness', description: 'A real bug / wrong behavior.' },
      { id: 'security', description: 'A vulnerability or unsafe pattern.' },
      { id: 'simplification', description: 'Reuse/simpler equivalent.' },
      { id: 'efficiency', description: 'Avoidable cost.' },
      { id: 'test-coverage', description: 'Missing/weak tests.' },
    ],
    appliesWhen: 'Per finding during a review pass.',
    effect: 'Tags the finding and orders it by severity.',
    minedFrom: 'Claude Code /code-review finding categories.',
  },
  {
    id: 'finding-verdict',
    group: 'review',
    title: 'Finding verdict',
    purpose: 'State confidence after verifying a finding.',
    labels: [
      { id: 'CONFIRMED', description: 'Reproduced/traced to a concrete failure.' },
      { id: 'PLAUSIBLE', description: 'Likely but not fully verified.' },
    ],
    appliesWhen: 'After a verify pass on a finding.',
    effect: 'Sets the verdict shown; PLAUSIBLE gets hedged.',
    minedFrom: 'Claude Code ReportFindings verdict field.',
  },
  {
    id: 'finding-severity',
    group: 'review',
    title: 'Finding severity',
    purpose: 'Rank how much a finding matters.',
    labels: [
      { id: 'critical', description: 'Data loss/security/hard-down.' },
      { id: 'high', description: 'Wrong results in a common path.' },
      { id: 'medium', description: 'Edge-case or degraded behavior.' },
      { id: 'low', description: 'Minor/cosmetic.' },
    ],
    defaultLabel: 'medium',
    appliesWhen: 'Per finding.',
    effect: 'Orders findings most-severe first.',
    minedFrom: 'Claude Code review ranking (most-severe first).',
  },
  {
    id: 'review-effort',
    group: 'review',
    title: 'Review effort level',
    purpose: 'Set breadth vs precision of a review.',
    labels: [
      { id: 'low', description: 'Few, high-confidence findings.' },
      { id: 'medium', description: 'Balanced.' },
      { id: 'high', description: 'Broader coverage, some uncertainty.' },
      { id: 'xhigh', description: 'Exhaustive.' },
      { id: 'max', description: 'Maximum breadth.' },
    ],
    defaultLabel: 'medium',
    appliesWhen: 'At the start of a review.',
    effect: 'Controls how many/uncertain findings are surfaced.',
    minedFrom: 'Claude Code review effort levels (low→max).',
  },

  // ── Session / loop control ─────────────────────────────────────────────
  {
    id: 'agent-mode',
    group: 'session',
    title: 'Agent mode',
    purpose: 'Set how autonomously the loop uses tools.',
    labels: [
      { id: 'auto', description: 'Use tools without asking.' },
      { id: 'plan', description: 'Outline a step-plan before acting.' },
      { id: 'ask', description: 'Confirm before each tool use.' },
    ],
    defaultLabel: 'auto',
    appliesWhen: 'Per session / per turn override.',
    effect: 'Gates the agentic tool loop.',
    minedFrom: 'Claude Code plan mode + permission prompting.',
    existingImpl: 'lib/settings (agentMode) + AppShell tool loop',
  },
  {
    id: 'chapter-boundary',
    group: 'session',
    title: 'Chapter boundary',
    purpose: 'Detect when work shifts to a new phase.',
    labels: [
      { id: 'continue', description: 'Same coherent stretch of work.' },
      { id: 'new-chapter', description: 'Meaningfully different phase/pivot.' },
    ],
    defaultLabel: 'continue',
    appliesWhen: 'As the session progresses.',
    effect: 'Marks a chapter divider / table-of-contents entry.',
    minedFrom: 'Claude Code mark_chapter behavior.',
  },
  {
    id: 'stop-reason',
    group: 'session',
    title: 'Turn stop reason',
    purpose: 'Explain why generation stopped, to drive loop continuation.',
    labels: [
      { id: 'end_turn', description: 'Complete answer — terminal.' },
      { id: 'tool_use', description: 'Wants a tool — continue after execution.' },
      { id: 'max_tokens', description: 'Truncated — may need continuation.' },
    ],
    appliesWhen: 'End of every model turn.',
    effect: 'Decides whether the agentic loop iterates again.',
    minedFrom: 'Claude Code tool-use loop (tool_use vs end_turn).',
    existingImpl: 'app/api/chat/route.ts + AppShell MAX_TOOL_TURNS loop',
  },
  {
    id: 'task-status',
    group: 'session',
    title: 'Task status',
    purpose: 'Track the state of a tracked task.',
    labels: [
      { id: 'pending', description: 'Not started.' },
      { id: 'in_progress', description: 'Actively being worked.' },
      { id: 'completed', description: 'Done and verified.' },
      { id: 'blocked', description: 'Waiting on a dependency/decision.' },
    ],
    defaultLabel: 'pending',
    appliesWhen: 'As tasks are created/worked.',
    effect: 'Updates the task list / progress UI.',
    minedFrom: 'Claude Code task tracking (in_progress/completed).',
  },
  {
    id: 'question-worthiness',
    group: 'session',
    title: 'Question worthiness',
    purpose: 'Decide when to ask the user vs choose a sensible default.',
    labels: [
      { id: 'decide-self', description: 'Has a conventional default — proceed and mention it.' },
      { id: 'ask-user', description: 'Genuinely the user\'s call — ask.' },
    ],
    defaultLabel: 'decide-self',
    appliesWhen: 'When facing an unresolved choice.',
    effect: 'Triggers an AskUserQuestion or an assumed default.',
    minedFrom: 'Claude Code AskUserQuestion guidance (only for user-owned decisions).',
  },
  {
    id: 'verification-verdict',
    group: 'session',
    title: 'Verification verdict',
    purpose: 'Judge whether a change actually does what it should, end-to-end.',
    labels: [
      { id: 'ok', description: 'Verified working.' },
      { id: 'sad', description: 'Partially working / caveats.' },
      { id: 'bad', description: 'Failed — report with output.' },
    ],
    defaultLabel: 'sad',
    appliesWhen: 'After a non-trivial change, before claiming done.',
    effect: 'Drives the honest outcome report + moat verification badge.',
    minedFrom: 'Claude Code /verify + "report outcomes faithfully".',
    existingImpl: 'The Assay ternary (ok/sad/bad) — project_assay_verdict_model',
  },

  // ── Domain (from skills) ───────────────────────────────────────────────
  {
    id: 'risk-matrix',
    group: 'domain',
    title: 'Risk (severity × likelihood)',
    purpose: 'Classify a risk and whether it needs escalation.',
    labels: [
      { id: 'low', description: 'Low severity/likelihood — proceed.' },
      { id: 'medium', description: 'Monitor / standard controls.' },
      { id: 'high', description: 'Mitigate before proceeding.' },
      { id: 'critical', description: 'Escalate to senior/outside review.' },
    ],
    defaultLabel: 'medium',
    appliesWhen: 'Assessing contract/deal/security exposure.',
    effect: 'Sets mitigation and escalation path.',
    minedFrom: 'Claude Code legal risk-assessment skill.',
  },
  {
    id: 'triage-color',
    group: 'domain',
    title: 'Triage color',
    purpose: 'Fast three-way triage of an incoming item.',
    labels: [
      { id: 'GREEN', description: 'Standard approval / auto-handle.' },
      { id: 'YELLOW', description: 'Needs a review pass.' },
      { id: 'RED', description: 'Full escalation / manual handling.' },
    ],
    defaultLabel: 'YELLOW',
    appliesWhen: 'On incoming items needing a routing decision (e.g. NDAs, alerts).',
    effect: 'Routes to auto/review/escalation lanes.',
    minedFrom: 'Claude Code NDA/triage skills (GREEN/YELLOW/RED).',
  },
  {
    id: 'compliance-applicability',
    group: 'domain',
    title: 'Compliance applicability',
    purpose: 'Determine which regulations/approvals apply to an action.',
    labels: [
      { id: 'none', description: 'No regulated surface.' },
      { id: 'privacy', description: 'Personal-data handling (GDPR/CCPA-class).' },
      { id: 'security', description: 'Security/attestation requirements.' },
      { id: 'financial', description: 'Financial/SOX-class controls.' },
    ],
    defaultLabel: 'none',
    appliesWhen: 'Before shipping a feature touching regulated data.',
    effect: 'Surfaces required approvals and jurisdictional rules.',
    minedFrom: 'Claude Code compliance-check skill.',
  },
]

// ── Registry helpers ──────────────────────────────────────────────────────
export const CLASSIFIER_GROUPS: ClassifierGroup[] = ['routing', 'safety', 'memory', 'review', 'session', 'domain']

export function classifierById(id: string): ClassifierDef | undefined {
  return CLAUDE_CODE_CLASSIFIERS.find((c) => c.id === id)
}

export function classifiersByGroup(group: ClassifierGroup): ClassifierDef[] {
  return CLAUDE_CODE_CLASSIFIERS.filter((c) => c.group === group)
}

export const CLASSIFIER_COUNT = CLAUDE_CODE_CLASSIFIERS.length
