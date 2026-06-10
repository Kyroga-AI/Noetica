export type ParticipantKind = 'human' | 'agent' | 'system'

export interface WorkroomParticipant {
  id: string
  name: string
  kind: ParticipantKind
  /** Agent archetype id — only set when kind === 'agent' */
  agentId?: string
  joinedAt: string
}

export type WorkroomMessageKind = 'chat' | 'dispatch' | 'result' | 'system'

export interface WorkroomMessage {
  id: string
  participantId: string
  participantName: string
  participantKind: ParticipantKind
  kind: WorkroomMessageKind
  content: string
  /** Set on 'dispatch' messages — the agent task that was sent */
  dispatchTask?: string
  /** Set on 'result' messages — the dispatch message id this answers */
  dispatchRef?: string
  createdAt: string
}

export type DispatchStatus = 'running' | 'done' | 'error'

export interface AgentDispatch {
  id: string
  agentId: string
  agentName: string
  task: string
  status: DispatchStatus
  messageId?: string   // the workroom message id for the result
  dispatchedAt: string
  completedAt?: string
}

export interface Workroom {
  id: string
  name: string
  description: string
  participants: WorkroomParticipant[]
  messages: WorkroomMessage[]
  dispatches: AgentDispatch[]
  createdAt: string
  updatedAt: string
  pinned?: boolean
}

export interface WorkroomStore {
  workrooms: Record<string, Workroom>
  version: number
}

export const WORKROOM_STORE_VERSION = 1
export const WORKROOM_STORE_KEY = 'noetica:workrooms'
export const MAX_WORKROOMS = 100

// ─── Built-in agent archetypes (standalone mode) ──────────────────────────────

export interface AgentArchetype {
  id: string
  name: string
  description: string
  systemPrompt: string
  tags: string[]
  color: string  // Tailwind bg color class
}

export const AGENT_ARCHETYPES: AgentArchetype[] = [
  {
    id: 'research',
    name: 'Research',
    description: 'Synthesises information, finds patterns, and summarises findings.',
    systemPrompt: 'You are Research, a specialist research agent. You synthesise information clearly, cite reasoning, and surface non-obvious connections. Be concise and structured.',
    tags: ['synthesis', 'analysis', 'summaries'],
    color: 'bg-[#7c3aed]',
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Reviews code for bugs, style issues, and security concerns.',
    systemPrompt: 'You are Code Review, a specialist code analysis agent. You identify bugs, security issues, and style violations. Be specific — reference line numbers or patterns. Suggest concrete fixes.',
    tags: ['bugs', 'security', 'style'],
    color: 'bg-[#0891b2]',
  },
  {
    id: 'planner',
    name: 'Planner',
    description: 'Breaks goals into tasks, milestones, and sequenced work plans.',
    systemPrompt: 'You are Planner, a specialist planning agent. You decompose objectives into concrete tasks with clear sequencing and dependencies. Output structured plans with milestones.',
    tags: ['tasks', 'milestones', 'sprints'],
    color: 'bg-[#059669]',
  },
  {
    id: 'writer',
    name: 'Writer',
    description: 'Drafts, edits, and improves prose for any audience.',
    systemPrompt: 'You are Writer, a specialist writing and editing agent. You draft, improve, and restructure text. Match the requested tone and audience. Be direct — show the revised text.',
    tags: ['drafting', 'editing', 'tone'],
    color: 'bg-[#d97706]',
  },
  {
    id: 'analyst',
    name: 'Analyst',
    description: 'Analyses data, identifies patterns, and produces structured assessments.',
    systemPrompt: 'You are Analyst, a specialist data and reasoning agent. You identify patterns, surface anomalies, and produce structured assessments. Use bullet points and tables where appropriate.',
    tags: ['data', 'patterns', 'assessment'],
    color: 'bg-[#dc2626]',
  },
]
