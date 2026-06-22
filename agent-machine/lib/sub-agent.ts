/**
 * Sub-agent roles for concierge dispatch.
 *
 * The concierge (main chat loop) can spawn focused sub-agents via the `dispatch_agent` tool —
 * the way Claude Code fans work out to Explore/Plan/general agents. Each role is a scoped system
 * prompt + a tool allowlist + an autonomy cap. A sub-agent runs its OWN short tool loop in an
 * isolated message history and returns a single self-contained result to the concierge; nothing
 * but its final answer crosses back, so the concierge's context stays clean.
 *
 * Roles are data (here); the runner lives in server.ts where the model + tool primitives are.
 */

export interface AgentRole {
  id: string
  label: string
  description: string   // shown to the concierge in the tool schema so it picks the right role
  systemPrompt: string
  tools: string[]       // BUILTIN_TOOLS names this role may use (dispatch_agent is never included)
  maxTurns: number
  model?: 'coder' | 'general'  // which local tier to run on (resolved to a concrete model by the runner)
}

const COMMON = 'You are a focused sub-agent dispatched by the Noetica concierge. Do ONE job well. ' +
  'Use your tools where they help. The concierge reads ONLY your final message, so end with a ' +
  'concise, self-contained result — findings, the answer, or what you changed and why. No chit-chat, ' +
  'no asking the user questions (there is no user here), no restating the task.'

export const AGENT_ROLES: Record<string, AgentRole> = {
  researcher: {
    id: 'researcher', label: 'Researcher',
    description: 'Gathers and synthesizes information from the web, local files, and the registry. Use for "find out / research / look up / compare" sub-tasks.',
    systemPrompt: `${COMMON} Your job: research the question thoroughly, cross-check sources, and synthesize a tight, sourced answer. Prefer primary facts over speculation; say what you could not verify.`,
    tools: ['web_search', 'public_data', 'read_file', 'list_directory', 'registry_lookup'],
    maxTurns: 6, model: 'general',
  },
  coder: {
    id: 'coder', label: 'Coder',
    description: 'Writes/edits code and runs commands in a workspace to make a change and verify it. Use for "implement / fix / refactor / write a script" sub-tasks.',
    systemPrompt: `${COMMON} Your job: make the code change and VERIFY it (run it / run a test). Report what you changed, the files, and the verification result. If you could not verify, say so explicitly.`,
    tools: ['run_command', 'code_execute', 'read_file', 'write_file', 'edit_file', 'list_directory'],
    maxTurns: 8, model: 'coder',
  },
  reviewer: {
    id: 'reviewer', label: 'Reviewer',
    description: 'Audits code or a plan for bugs, risks, and gaps. Use for "review / critique / check / find problems" sub-tasks.',
    systemPrompt: `${COMMON} Your job: adversarially review the target. List concrete issues (file:line where you can), each with severity and a fix. If it is sound, say so plainly — do not invent problems.`,
    tools: ['read_file', 'list_directory', 'run_command'],
    maxTurns: 6, model: 'coder',
  },
  analyst: {
    id: 'analyst', label: 'Analyst',
    description: 'Analyzes data and produces numbers or a chart spec. Use for "analyze / compute / chart / summarize this data" sub-tasks.',
    systemPrompt: `${COMMON} Your job: analyze the data and report the findings — the numbers that matter and what they mean. Produce a chart when it clarifies.`,
    tools: ['public_data', 'render_chart', 'read_file', 'list_directory'],
    maxTurns: 5, model: 'general',
  },
  planner: {
    id: 'planner', label: 'Planner',
    description: 'Breaks a goal into an ordered, concrete plan. Use for "plan / break down / outline the approach" sub-tasks. Does not execute.',
    systemPrompt: `${COMMON} Your job: produce a concrete, ordered plan — numbered steps, each an actionable change with the file/area it touches and how to verify it. No execution, no tools needed; think it through and write the plan.`,
    tools: ['read_file', 'list_directory'],
    maxTurns: 3, model: 'general',
  },
  general: {
    id: 'general', label: 'General',
    description: 'A capable generalist for any focused sub-task that does not fit a specialist role.',
    systemPrompt: `${COMMON} Your job: complete the task end to end and return the result.`,
    tools: ['web_search', 'public_data', 'read_file', 'write_file', 'edit_file', 'list_directory', 'run_command', 'registry_lookup'],
    maxTurns: 6, model: 'general',
  },
}

export function resolveRole(id: string | undefined): AgentRole {
  return AGENT_ROLES[String(id ?? '').toLowerCase()] ?? AGENT_ROLES.general!
}

/** The roles the concierge may dispatch — surfaced in the dispatch_agent tool schema. */
export const DISPATCHABLE_ROLES = Object.keys(AGENT_ROLES)
