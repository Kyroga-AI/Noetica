# Noetica SourceOS Workspace Implementation Matrix

Status: planning baseline  
Scope: product shell, SourceOS-native data spine, screen families, connector authority, and implementation tranches  
Non-goal: this document does not claim implementation is complete. It defines the build target and acceptance criteria.

## 1. Product thesis

Noetica is a SourceOS-native AI operating workspace where notes, chats, repositories, agents, mail, calendar, graph intelligence, and work management converge. External services such as GitHub, Gmail, Jira, Slack, Linear, and Google Calendar are optional connectors, not default authorities.

The product baseline combines three design references:

1. Claude-style workspace ergonomics: chat, cowork, code, projects, artifacts, customize, skills, connectors, organization settings, analytics.
2. OpenAI/Codex-style coding operations: automations, local environments, worktrees, hooks, computer use, connections, settings, archived chats.
3. Noetica/SourceOS-native authority: Gitea-sovereign, generic Git, Prophet Mail/Workspace, Sociosphere graph, Matrix workrooms, agent registry, graph/time-service operational intelligence.

## 2. Authority rules

These rules are architectural requirements, not copy preferences.

1. SourceOS is the native substrate. Standalone mode is a fallback/dev posture, not the product authority.
2. Gitea-sovereign and generic Git are the native source-control substrate.
3. GitHub is optional external source control. It may import, mirror, hook, or sync repositories, but it must not be the default repository authority.
4. Prophet Mail and Prophet Workspace are native workspace utilities. Gmail and Google Workspace are optional external connectors.
5. Native work management owns tasks, backlog, epics, sprints, boards, dispatch, and workrooms. Jira, Linear, GitHub Issues, and GitLab Issues are optional connectors/import-export targets.
6. Chats are notes. Every chat thread must be backed by a note-like durable object.
7. Notes can be upgraded into tasks, artifacts, project notes, workroom records, sprint candidates, evidence reports, or implementation work.
8. Workrooms are collaborative execution spaces inside projects and may attach Matrix rooms, agents, tasks, notes, artifacts, repositories, mail, calendar, and SourceOS events.
9. Agent registry is first-class. External or internal agents can register, sync content, receive assignments, and contribute work products with provenance.
10. Sociosphere graph health, SourceOS health, time service, event ledger, repository graph, sync queues, and agent mesh status are first-class operational intelligence screens.

## 3. Canonical data spine

Implement these entities before building deep screen behavior. Static fixtures are acceptable for the first tranche.

### Workspace

```ts
type Workspace = {
  id: string
  name: string
  organizationId?: string
  defaultProjectId?: string
  sourceosEnabled: boolean
}
```

### Notes and chats

```ts
type Note = {
  id: string
  title: string
  body: string
  kind: 'quick_note' | 'chat_thread' | 'working_note' | 'artifact_note' | 'project_note'
  status: 'draft' | 'active' | 'promoted' | 'archived'
  projectId?: string
  workroomId?: string
  sourceThreadId?: string
  createdAt: string
  updatedAt: string
  tags: string[]
  provenanceRefs: string[]
}

type ChatThread = {
  id: string
  noteId: string
  title: string
  messages: ChatMessage[]
  projectId?: string
  workroomId?: string
  artifactIds: string[]
  promotedWorkItemIds: string[]
  modelContext: ModelRunContext
  createdAt: string
  updatedAt: string
}
```

### Work management

```ts
type WorkItem = {
  id: string
  title: string
  description: string
  type: 'task' | 'bug' | 'story' | 'epic' | 'initiative' | 'research' | 'spike'
  status: 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  projectId?: string
  workroomId?: string
  sprintId?: string
  sourceNoteId?: string
  sourceThreadId?: string
  ownerId?: string
  assignedAgentIds: string[]
  acceptanceCriteria: string[]
  estimate?: string
  dueDate?: string
  linkedArtifactIds: string[]
  linkedRepoRefs: RepoRef[]
  createdAt: string
  updatedAt: string
}

type Sprint = {
  id: string
  projectId: string
  name: string
  startDate?: string
  endDate?: string
  capacity?: number
  workItemIds: string[]
  status: 'planning' | 'active' | 'closed'
}
```

### Projects and workrooms

```ts
type Project = {
  id: string
  name: string
  description?: string
  visibility: 'private' | 'team' | 'organization'
  workroomIds: string[]
  noteIds: string[]
  artifactIds: string[]
  backlogItemIds: string[]
  connectorRefs: ConnectorRef[]
  repoRefs: RepoRef[]
  matrixRoomIds: string[]
}

type Workroom = {
  id: string
  projectId: string
  name: string
  objective?: string
  participantIds: string[]
  agentIds: string[]
  matrixRoomId?: string
  chatThreadIds: string[]
  taskIds: string[]
  artifactIds: string[]
  dispatchQueueIds: string[]
}
```

### Generic Git / forge substrate

```ts
type ForgeProvider =
  | 'gitea_sovereign'
  | 'local_git'
  | 'git_ssh'
  | 'github'
  | 'gitlab'
  | 'forgejo'
  | 'other'

type SourceForge = {
  id: string
  provider: ForgeProvider
  name: string
  baseUrl?: string
  default: boolean
  trustTier: 'native' | 'trusted' | 'external' | 'untrusted'
  connectionStatus: 'connected' | 'disconnected' | 'degraded' | 'error'
  authMode: 'local' | 'ssh_key' | 'token' | 'oauth' | 'sourceos_grant'
  sourceosRef?: string
  lastSyncAt?: string
}

type RepositoryRef = {
  id: string
  forgeId: string
  name: string
  ownerOrNamespace: string
  cloneUrl: string
  defaultBranch: string
  visibility: 'private' | 'internal' | 'public'
  localPath?: string
  sourceosNodeId?: string
  graphNodeId?: string
  healthStatus: 'healthy' | 'stale' | 'degraded' | 'failed' | 'unknown'
  lastObservedAt?: string
}
```

### Mail and workspace utilities

```ts
type MailProvider = 'prophet_mail' | 'gmail' | 'imap' | 'microsoft_graph' | 'other'

type MailAccount = {
  id: string
  provider: MailProvider
  address: string
  displayName: string
  native: boolean
  status: 'connected' | 'disconnected' | 'degraded' | 'error'
  sourceosRef?: string
  lastSyncAt?: string
}

type WorkspaceMessage = {
  id: string
  accountId: string
  subject: string
  from: string
  to: string[]
  receivedAt: string
  projectId?: string
  workroomId?: string
  relatedNoteIds: string[]
  relatedTaskIds: string[]
  sourceosEventRef?: string
}
```

### Agent registry and sync

```ts
type AgentIdentity = {
  id: string
  displayName: string
  provider: 'local' | 'sourceos' | 'matrix' | 'external'
  status: 'connected' | 'offline' | 'pending' | 'revoked'
  capabilities: string[]
  trustLevel: 'unverified' | 'verified' | 'organization' | 'system'
  syncEnabled: boolean
  lastSyncAt?: string
}

type AgentSyncRecord = {
  id: string
  agentId: string
  source: string
  importedObjectType: 'note' | 'task' | 'artifact' | 'thread' | 'report'
  importedObjectId: string
  status: 'queued' | 'synced' | 'conflict' | 'failed'
  provenanceRef: string
}
```

### Graph and time-service operations

```ts
type GraphHealthStatus = {
  graphId: string
  status: 'healthy' | 'degraded' | 'failed' | 'unknown'
  nodeCount: number
  edgeCount: number
  pendingIngestCount: number
  failedIngestCount: number
  orphanNodeCount: number
  duplicateEntityCount: number
  stalePartitionCount: number
  lastIndexedAt?: string
  lastReasonedAt?: string
  lastSnapshotAt?: string
  vectorIndexStatus: 'fresh' | 'stale' | 'building' | 'failed' | 'unknown'
}

type TimeServiceStatus = {
  serviceId: string
  status: 'healthy' | 'degraded' | 'failed' | 'unknown'
  logicalTime: string
  latestEventTime: string
  ledgerLagMs: number
  clockSkewMs: number
  lastCheckpointAt?: string
  replayWindowStart?: string
  replayWindowEnd?: string
}
```

### Automations

```ts
type Automation = {
  id: string
  title: string
  prompt: string
  schedule?: string
  trigger: 'manual' | 'schedule' | 'event' | 'sourceos_event' | 'repo_event' | 'mail_event'
  scope: 'workspace' | 'project' | 'workroom' | 'repo' | 'mail' | 'calendar' | 'graph'
  outputTarget: 'chat' | 'note' | 'task' | 'artifact' | 'report' | 'dispatch'
  enabled: boolean
  lastRunAt?: string
  nextRunAt?: string
  agentIds: string[]
}
```

### Local environments and device connections

```ts
type LocalEnvironment = {
  id: string
  projectId: string
  name: string
  rootPath?: string
  worktreePath?: string
  forgeId?: string
  repositoryIds: string[]
  runtime: 'local' | 'sourceos' | 'agent_machine' | 'remote'
  setupCommands: string[]
  envVars: string[]
  status: 'not_configured' | 'ready' | 'degraded' | 'failed'
  lastCheckedAt?: string
}

type DeviceConnection = {
  id: string
  name: string
  type: 'mac' | 'phone' | 'linux' | 'ssh' | 'agent_machine' | 'browser'
  direction: 'controls_this_device' | 'controlled_by_this_device' | 'peer'
  status: 'connected' | 'pending' | 'offline' | 'revoked'
  trustTier: 'local' | 'trusted' | 'organization' | 'external'
  permissions: string[]
  sourceosGrantRef?: string
}
```

## 4. Global shell implementation requirements

### Product shell layout

All normal workspace screens use this frame:

```text
┌──────────────────────────────────────────────────────────────┐
│ Native/title strip                                            │
├───────────────┬────────────────────────────────────┬─────────┤
│ Left rail     │ Main content / work canvas          │ Utility │
│               │                                    │ rail    │
└───────────────┴────────────────────────────────────┴─────────┘
```

### Left rail

Expanded width: 250-300 px.  
Collapsed width: 56-72 px.  
Top-level mode pills: Chat, Cowork, Code.

Mode-specific navigation:

Chat mode:
- New chat
- Projects
- Artifacts
- Ask SocioProphet
- Customize

Cowork mode:
- New task
- Projects
- Scheduled
- Live artifacts
- Dispatch
- Customize

Code mode:
- New session
- Routines
- Repositories
- Environments
- Worktrees
- Automations
- Customize

Shared lower sections:
- Pinned
- Recents
- account / organization footer
- settings / sync / utility affordances

### Right utility rail

Collapsed by default. The icon rail contains:

- Calendar
- Prophet Mail
- Matrix
- Agents
- Related
- Evidence
- SourceOS
- Graph

The utility rail is contextual. It must not permanently replace the main workspace.

### Command palette

Cmd+K opens command palette. Initial commands:

- New chat
- New task
- New project
- New artifact
- Promote current chat to task
- Open Projects
- Open Artifacts
- Open Ask SocioProphet
- Open Customize
- Open Automations
- Open Source Control
- Open Graph Health
- Open Agent Registry
- Open Settings
- Toggle sidebar
- Toggle utility rail

## 5. Screen matrix

### 5.1 Chat thread

Purpose: default conversation surface; every chat is backed by a Note.

Required route: `chat/thread/:threadId` or equivalent in client state.

Required layout:

- left rail with Chat active
- header row with title, share/export/more controls
- centered transcript column
- assistant messages as prose blocks
- user messages as compact right-aligned bubbles
- hidden metadata by default
- assistant action row: copy, read/play, feedback, retry, promote, evidence, more
- bottom composer with attach, context selector, model selector, voice/send
- optional quota/runtime strip above composer

Required behavior:

- chat creates/uses `noteId`
- every message belongs to a note-backed thread
- promote action opens promotion menu
- promotion can create task, epic, sprint candidate, project note, artifact, workroom, evidence report

Acceptance:

- visible user text is never polluted with mode prefixes
- source note/thread is preserved when work is created
- governance/evidence is on demand, not noisy by default

### 5.2 Notes workspace

Purpose: treat chats as notes and allow upgrades over time.

Required layout:

- left folders/collections/projects
- middle note list grouped by pinned/today/year
- right note editor/thread/artifact preview

Required folders:

- All workspace
- Notes
- Chats
- Projects
- Workrooms
- Shared
- Recently deleted
- custom collections

Required note actions:

- Promote
- Add to project
- Create task
- Create artifact
- Send to agent
- Export evidence

Acceptance:

- every chat can be opened as a note
- every note can be promoted into work
- notes retain provenance
- notes can attach to projects/workrooms/artifacts

### 5.3 Native work management

Purpose: Jira-compatible functionality without Jira as authority.

Required screens:

- Work item detail
- Backlog
- Sprint planning
- Board
- Promote chat/note modal

Work item detail layout:

- title
- status
- priority
- assignee/agent
- project/workroom
- description
- acceptance criteria
- source chat/note
- linked artifacts
- linked code/PRs
- activity log

Sprint planning layout:

- left backlog
- center sprint candidate list
- right capacity/risks/agents

Board columns:

- Backlog
- Ready
- In progress
- Blocked
- Review
- Done

Acceptance:

- chat/thread can create one or more work items
- work item can be assigned to human or agent
- work item can enter backlog/sprint/board
- Jira/Linear/GitHub Issues are optional import/export connectors only

### 5.4 Cowork home

Purpose: task-driven working mode.

Required layout:

- Cowork mode active
- nav: New task, Projects, Scheduled, Live artifacts, Dispatch, Customize
- onboarding card in left rail
- hero: `Let's knock something off your list`
- large composer: `How can I help you today?`
- project selector
- Ask selector
- model selector
- suggested actions below composer

Noetica additions:

- project selector chooses Project or Workroom
- Ask selector chooses Noetica, agent, Matrix room, SourceOS, or repository
- composer can create task, plan, sprint, artifact, or dispatch

Acceptance:

- Cowork home is distinct from placeholder board
- creates task/workroom-backed work
- shows onboarding and suggestions

### 5.5 Cowork projects

Purpose: project-centric cowork browser/search.

Required layout:

- header: Projects
- sort, search, New project
- cards or search overlay
- project cards with title/date/team

Acceptance:

- New project action exists
- search results include chats, projects, workrooms, tasks
- selecting project opens project detail/workroom

### 5.6 Scheduled tasks

Purpose: recurring or scheduled agent/work tasks.

Required layout:

- header: Scheduled tasks
- subtitle explaining schedules
- sort/search/New task controls
- notice: scheduled tasks run while computer is awake
- Keep awake toggle
- empty clock state
- quick templates: Daily brief, Weekly review

Acceptance:

- schedule object model exists
- empty state and templates render
- future schedule can run chatops/agent action

### 5.7 Live artifacts

Purpose: dynamic artifacts refreshed by connectors or workspace data.

Required layout:

- header: Live artifacts
- description references live data from connectors
- Import from link
- New artifact dropdown
- empty folder/document state
- quick templates: Unread email digest, What needs my attention

Acceptance:

- live artifact model exists
- connector-backed template placeholders exist
- future template creates refreshable artifact

### 5.8 Dispatch

Purpose: hand off tasks and conversations to devices, agents, Matrix rooms, and workrooms.

Required layout:

- Dispatch active under Cowork
- centered device/phone card
- title: One conversation from anywhere
- Pair your phone CTA
- safety/permission note

Noetica additions:

- dispatch targets include phone, Matrix room, agent, workroom, calendar/mail workflow, SourceOS runtime

Acceptance:

- dispatch target model exists
- pair phone CTA exists
- agent/workroom dispatch path is represented

### 5.9 Code workroom

Purpose: code mode with repo context, worktrees, diffs, commands, PRs, and implementation handoff.

Required layout:

- Code mode active
- nav: New session, Routines, Repositories, Environments, Worktrees, Automations, Customize
- main work feed / terminal-like run blocks
- PR/status cards
- branch/CI metadata
- command input bottom
- Accept edits region
- model selector / cost / status
- optional split-pane repo/file/diff/log view

Acceptance:

- repository can be selected from generic source-control substrate
- repo tree/file/diff/log placeholders render
- code session can create work item or artifact
- code session can hand off implementation to agent

### 5.10 Source Control / Forge Workspace

Purpose: generic Git/Gitea-sovereign source-control browser.

Required source overview layout:

- Native sources: Gitea Sovereign, Local Git, SourceOS repository graph
- External connectors: GitHub, GitLab, Forgejo, other
- cards show provider, trust tier, status, repo count, last sync, hooks, graph indexed count

Required Gitea-sovereign detail layout:

- API reachable
- SSH reachable
- webhook receiver
- mirror queue
- last graph sync
- repository count
- failed syncs
- repository list
- hook state
- graph ingestion state

External GitHub connector layout:

- GitHub is optional
- import repositories
- register webhooks
- pull PR/issues/actions metadata
- mirror to Gitea Sovereign
- disconnect

Acceptance:

- GitHub is never displayed as default authority
- native sources appear first
- repository health derives from SourceOS/Gitea/repository graph

### 5.11 Git/forge repository browser

Purpose: browse org/repo inventory from native or external sources.

Required layout:

- provider filter: All sources, Gitea Sovereign, Local Git, GitHub, GitLab, Forgejo, External
- left filters: All, Owned, Admin access, Public, Private, Sources, Forks, Archived, Templates
- main search
- repo count
- list/table toggle
- sort by last pushed
- repo rows with name, namespace, description, language, health, stars/forks if available

Acceptance:

- selecting repo can attach it to Code workroom, Project, or Workroom
- repo row shows source authority/trust tier

### 5.12 Artifacts library

Purpose: central artifact browser.

Required layout:

- title: Artifacts
- search bar
- New artifact button
- empty icon and text
- artifact grid/list when populated

Artifact types:

- document
- code
- report
- live artifact
- notebook
- graph
- dashboard
- evidence bundle
- sprint plan
- model comparison

Acceptance:

- artifact model exists
- empty state renders
- artifact detail/canvas can open

### 5.13 Ask SocioProphet

Purpose: org knowledge / enterprise search / connector-backed assistant.

Required layout:

- centered connector/app constellation visual
- org badge: SocioProphet
- headline: Turn Noetica into the SocioProphet expert
- subtitle about instant answers across work apps
- setup CTA
- disable link

Noetica additions:

- SourceOS graph/source selection
- connector scope
- project/workroom scoped search
- provenance display

Acceptance:

- route exists
- setup CTA opens connector/source setup
- future query result can show provenance

### 5.14 Customize landing

Purpose: entry to skills, connectors, and plugins.

Required layout:

- left customize nav
- skills/connectors top
- personal plugins
- organization plugins
- centered landing icon/title/subtitle
- action cards: Connect your apps, Create new skills, Browse plugins

Acceptance:

- route exists
- landing cards navigate to proper family

### 5.15 Skills browser/detail

Purpose: browse and inspect skills.

Required layout:

- three columns: customize nav, skill tree/list, detail pane
- skill tree includes personal and built-in groups
- right detail shows metadata, trigger, description, toggle, file preview
- view/code toggle placeholder

Acceptance:

- skill tree expands/collapses
- metadata renders
- toggle exists
- markdown/code preview placeholder exists

### 5.16 Connectors browser/detail

Purpose: manage native and external connectors.

Required taxonomy:

Native:
- SourceOS
- Gitea Sovereign
- Prophet Mail
- Prophet Workspace
- Sociosphere Graph
- Matrix
- Agent Registry

External:
- GitHub
- Gmail
- Google Drive
- Google Calendar
- Slack
- GitLab
- Forgejo
- Jira
- Linear
- Notion

Each connector shows:

- authority: native authority, external mirror, external source, optional hook
- trust tier
- sync mode
- status
- permissions

Acceptance:

- native connectors appear before external connectors
- external connectors are labeled optional
- GitHub/Gmail/Jira are not default authorities

### 5.17 Plugin detail

Purpose: marketplace/org plugin detail.

Required layout:

- plugin metadata: source, version, author, last updated
- update/customize/toggle/more controls
- description
- tabs: Skills, Connectors, Agents
- skill cards grid
- Try asking list

Acceptance:

- plugin detail route renders
- tabs exist
- skill cards and prompt suggestions render

### 5.18 Directory modal

Purpose: browse skills/connectors/plugins.

Required layout:

- modal over dimmed/blurred customize screen
- title: Directory
- left categories: Skills, Connectors, Plugins
- search
- tabs: Your organization, Shared, SocioProphet, Open ecosystem, Agent registry, SourceOS packages
- filter and sort controls
- empty or grid state

Acceptance:

- modal opens
- category/tabs switch visually
- search/filter/sort controls exist

### 5.19 Settings modal

Purpose: user-level app settings.

Required left nav:

Personal:
- General
- Profile
- Appearance
- Configuration
- Personalization
- Keyboard shortcuts
- Usage & billing

Integrations:
- Appshots
- MCP servers / tool servers
- Browser
- Computer use

Coding:
- Hooks
- Connections
- Git
- Environments
- Worktrees

Archived:
- Archived chats

SocioProphet/Noetica:
- Organization

Acceptance:

- modal taxonomy matches user/coding/integration needs
- Account/Usage panels can coexist with this taxonomy
- Organization opens admin shell

### 5.20 Account settings

Purpose: account/session/device view.

Required content:

- logout all devices
- delete account
- role
- primary owner
- organization ID
- active sessions table

Acceptance:

- account panel exists
- sessions table renders static data first

### 5.21 Usage settings

Purpose: usage/limits.

Required content:

- Your usage limits / Team tabs
- current session usage bar
- weekly limit bar
- daily routine/automation quota
- last updated timestamp
- refresh icon

Acceptance:

- usage panel exists
- progress bars render
- team tab placeholder exists

### 5.22 Environments settings

Purpose: configure local worktrees/runtime environments.

Required layout:

- title: Environments
- subtitle: Local environments tell Noetica how to set up worktrees for a project
- Select a project
- New project card
- Add project button

Acceptance:

- environment model exists
- route/panel renders
- project can be selected/added in scaffold

### 5.23 Connections / computer use

Purpose: control this Mac, other devices, and SSH.

Required layout:

- title: Connections
- tabs: Control this Mac, Control other devices, SSH
- devices card
- Set up CTA

Noetica additions:

- SourceOS grants
- device trust tier
- Agent Machine registration
- Matrix/chatops dispatch
- SSH/Gitea/Forge connections

Acceptance:

- device connection model exists
- three tabs render
- setup CTA exists

### 5.24 Automations

Purpose: scheduled/event/manual workflows.

Required layout:

- left rail with Automations active
- title: Automations
- subtitle: Run chats on a schedule or whenever you need them
- top right: View templates, Create via chat
- template panel with Set up manually
- two-column cards

Noetica template examples:

- Scan recent commits and propose fixes
- Draft weekly release notes
- Summarize git activity
- Summarize CI failures
- Suggest next skills
- Synthesize weekly PRs/incidents/reviews
- Compare changes to benchmarks/traces
- Graph health digest
- Mail/calendar attention digest

Acceptance:

- automation model exists
- templates render
- Create via chat and Set up manually actions exist

### 5.25 Organization settings

Purpose: full admin shell.

Required left nav:

- org selector
- notifications
- organization and access
- billing
- usage
- data and privacy
- capabilities
- models
- members
- products
- libraries
- plugins
- connectors
- skills

Required organization/access content:

- team overview
- allowed email domains
- seats
- members
- team name/logo
- organization instructions
- domains table

Noetica additions:

- SourceOS org identity
- agent registry governance
- workspace sync policies
- Matrix rooms policy
- evidence retention
- model routing policy

Acceptance:

- admin shell exists separately from settings modal
- org access page renders

### 5.26 Analytics family

Purpose: org/product/operational analytics.

Required routes:

- All activity
- Chat / Noetica Chat
- Noetica Code
- Cowork
- Code Review
- Notebook analytics
- Model analytics
- Graph/vector/Neuronpedia dashboards
- Operational intelligence

All Activity content:

- app filter rail
- notices
- KPI cards: WAU, Utilization, Pending invites
- active users chart
- top connectors chart

Code analytics:

- lines accepted
- suggestion accept rate
- activity chart
- lines chart
- team table
- search/export

Operational intelligence:

- Sociosphere graph health
- SourceOS health
- time service
- event ledger
- sync queues
- repository graph
- agent mesh
- connector health

Acceptance:

- analytics shell exists
- static charts/cards render
- operational intelligence is first-class, not buried

### 5.27 Sociosphere graph health

Purpose: inspect graph health, state, time service, and operational intelligence.

Required cards:

- Graph state
- nodes indexed
- edges indexed
- pending ingest
- failed ingest
- last reasoning pass
- last graph compaction
- last snapshot
- vector index status

Time service section:

- logical time
- latest event time
- clock skew
- ledger lag
- last checkpoint
- replay window

Tables:

- recent graph events
- stale graph partitions
- degraded sources
- failed transforms
- top active projects/workrooms/repos

Actions:

- refresh graph
- run health check
- export snapshot
- open graph explorer
- open event ledger
- open replay view

Acceptance:

- graph health route renders
- time service status renders
- operational intelligence actions exist as buttons

### 5.28 Right utility rail

Purpose: Google-style integrated side utilities.

Required icons:

- Calendar
- Prophet Mail
- Matrix
- Agents
- Related
- Evidence
- SourceOS
- Graph

Panel requirements:

Mail:
- inbox summary
- unread
- flagged
- related to project/workroom/repo
- compose
- attach email to note/task
- create task from email

Calendar:
- agenda
- upcoming events
- schedule task
- create workroom from meeting
- attach meeting to project/note

Matrix:
- linked rooms
- unread messages
- agent rooms
- chatops commands

SourceOS:
- runtime status
- graph health
- event ledger
- sync queues
- latest events
- replay/export

Acceptance:

- rail exists globally
- opening one utility does not navigate away from current screen
- utilities can attach data to current note/project/task in scaffold

### 5.29 Agent registry and sync

Purpose: sign in/register agents and sync their content into workspace.

Required screens:

- Agent registry
- Agent detail
- Sync inbox

Registry table columns:

- name
- provider
- status
- capabilities
- trust level
- last sync
- actions

Sync inbox:

- imported notes
- imported tasks
- imported artifacts
- conflicts
- approve/import/archive

Acceptance:

- agent registry route exists
- agent table renders
- sync inbox renders
- imported content maps to notes/tasks/artifacts

### 5.30 Matrix / ChatOps / Workrooms

Purpose: collaborative execution spaces inside projects.

Workroom layout:

- project/workroom header
- participants
- agents
- status
- tabs: Chat, Tasks, Artifacts, Agents, Matrix, Timeline, Evidence
- chatops composer
- slash commands
- assign agent
- run task
- create artifact
- sync room
- dispatch

Acceptance:

- workroom route exists
- matrix placeholder exists
- agent roster exists
- chatops command list exists

## 6. Tranche plan

### Tranche 0: Authority model and data spine

Deliver:

- core type files
- static fixtures
- source authority model
- note/chat/work/project/workroom/artifact/agent/repo/mail/graph models

Acceptance:

- TypeScript compiles
- no UI breakage
- no backend required

### Tranche 1: Product shell IA reset

Deliver:

- ProductShell
- ProductSidebar
- Chat/Cowork/Code top modes
- product navigation
- pinned/recents
- account footer
- right utility rail scaffold
- SourceOS default posture

Acceptance:

- shell matches target IA
- internal Evaluate/Govern no longer primary
- utilities visible/collapsible

### Tranche 2: Core workspace screens

Deliver:

- polished Chat Thread
- Notes Workspace
- Projects
- Artifacts
- Ask SocioProphet
- Source Control browser

Acceptance:

- screens render from static fixtures
- navigation works
- search/create controls exist

### Tranche 3: Work management and promotion

Deliver:

- promote chat/note menu
- task creation modal
- work item detail
- backlog
- sprint planning
- board
- workroom base

Acceptance:

- chat can become task/work item
- work item links source note/thread
- board/sprint views render

### Tranche 4: Cowork operational screens

Deliver:

- Cowork home
- Cowork projects
- Scheduled tasks
- Live artifacts
- Dispatch

Acceptance:

- Cowork screen family matches target layout
- task/schedule/live artifact scaffolds exist

### Tranche 5: Customize ecosystem

Deliver:

- Customize landing
- Skills browser/detail
- Connectors browser/detail
- Plugin detail
- Directory modal

Acceptance:

- native connectors appear before external connectors
- generic Git/Gitea and Prophet Mail/Workspace are native
- GitHub/Gmail/Jira are optional external connectors

### Tranche 6: Settings, environments, automations

Deliver:

- expanded settings modal
- Account
- Usage
- Environments
- Connections
- Computer use
- Automations

Acceptance:

- OpenAI/Codex-style coding settings are represented
- automations template grid exists
- local environment/worktree settings exist

### Tranche 7: Organization and analytics

Deliver:

- organization settings shell
- analytics shell
- all activity
- code analytics
- code review analytics
- notebook analytics
- model analytics
- operational intelligence
- graph health/time service

Acceptance:

- org admin shell is separate from modal settings
- operational intelligence is first-class

### Tranche 8: Collaboration and integration overlays

Deliver:

- Matrix workrooms
- agent registry
- sync inbox
- mail/calendar utility panels
- SourceOS utility panel
- graph utility panel

Acceptance:

- workrooms support agent and Matrix placeholders
- external agent sync model is visible
- right rail utilities can attach to notes/tasks/projects

## 7. First PR recommendation

Title:

`Define SourceOS-native workspace data spine and product IA matrix`

Files:

- `lib/types/workspace.ts`
- `lib/types/note.ts`
- `lib/types/work.ts`
- `lib/types/artifact.ts`
- `lib/types/agent.ts`
- `lib/types/sourceControl.ts`
- `lib/types/mail.ts`
- `lib/types/graph.ts`
- `lib/types/automation.ts`
- `lib/types/environment.ts`
- `lib/fixtures/workspace.ts`
- `docs/product/sourceos-workspace-implementation-matrix.md`

Acceptance:

- no runtime behavior change required
- typecheck passes
- lint passes
- build passes
- document is the implementation source of truth

## 8. Non-negotiable acceptance constraints

1. GitHub must not appear as default source-control authority.
2. Gitea-sovereign and generic Git must appear before GitHub.
3. Any third-party connector must be labeled optional/external.
4. SourceOS must be native substrate, not a secondary product identity.
5. Prophet Mail/Workspace must be native; Gmail is optional external.
6. Native work management must exist; Jira is optional external.
7. Chats must be note-backed.
8. Notes must be promotable into work, artifacts, projects, evidence, and workrooms.
9. Workrooms must support agents, Matrix/chatops, tasks, notes, and artifacts.
10. Sociosphere graph health and time service must be first-class operational screens.
11. Right utility rail must support mail, calendar, Matrix, agents, related data, evidence, SourceOS, and graph.
12. Automations must be scoped to workspace/project/workroom/repo/mail/calendar/graph.
13. Environments and worktrees must support local, SourceOS, Agent Machine, and remote runtimes.
14. GitHub, Gmail, Google Calendar, Jira, Slack, GitLab, and Linear must enter through explicit connectors only.
