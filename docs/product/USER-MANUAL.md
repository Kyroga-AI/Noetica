# Noetica — User Manual

> Living document. Started 2026-07-16 from a code-grounded Q&A session covering the Workspace and AI·Models
> command centers plus Settings. Last updated 2026-07-16 with deeper detail on Labs (§4.4) and Agent Builder
> (§4.5). Every claim below was verified against the actual component source at the time of writing — not the
> product vision docs. Re-verify against source before trusting a claim as still current; the codebase moves
> daily (nightly cask builds, active upstream development by SocioProphet/Noetica).
>
> **Repo**: fork `Kyroga-AI/Noetica`, upstream `SocioProphet/Noetica` (maintained by mdheller / Michael Haller).
> Local clone: `~/Developer/Noetica`. Kept in sync by the daily `noetica-fork-sync` scheduled task.

---

## 1. What Noetica Is

Noetica is **the governed chat surface for the SocioProphet / SourceOS stack** — a local-first AI desktop app
(Next.js 14 App Router + TypeScript + Tailwind + Zustand, packaged as a Tauri 2 desktop app; also runs in-browser).

Two operating modes:
- **Standalone** — direct provider calls through your own API keys.
- **SourceOS** — submission through "Superconscious," with model routing, policy admission, memory scope, and
  evidence references surfaced back into the UI.

**Authority boundaries** (from the repo README): Noetica owns the chat surface, provider abstraction, steering
UX, governance trail display, and the Superconscious adapter interface. It does **not** own memory, model
routing, policy admission, or agent evidence authority — those are delegated to sibling repos `memory-mesh`,
`model-router`, `guardrail-fabric`, and `agentplane`.

A recurring design thread across surfaces is **sovereignty**: local-first storage, on-device model options,
explicit "tokens egressed" tracking, self-hosted mail/calendar as a Google Workspace replacement, and a stated
goal of Noetica being usable fully offline where possible.

---

## 2. Navigation Model — Command Centers

Noetica's entire left rail is driven by one registry: `components/shell/commandCenters.ts`. It's a **two-axis
system**, explicitly modeled after SocioProphet's client-vue cockpit pattern:

- **Domain axis** (Tier 1, leftmost rail) — which **Command Center** you're in
- **Capability axis** (Tier 2, labeled panel) — that center's tools, called **Surfaces**

### The seven Command Centers

| id | Label | Blurb | Covered in this manual? |
|---|---|---|---|
| `workspace` | Workspace | Chat, canvas, notes & rooms — where the work happens | ✅ Section 3 |
| `workstation` | Workstation | Local-first dev — Gitea repos, Porter deploys, local GitOps | ⬜ not yet explored |
| `data` | Data | Corpus, canon, ingestion & the knowledge graph | ⬜ not yet explored |
| `ai` | AI · Models | Studio, evaluation, tuning, boards & agents | ✅ Section 4 |
| `cloud` | Cloud · DevSecOps | Off-machine — comes AFTER local DevSecOps is real | ⬜ not yet explored |
| `analytics` | Analytics | Dashboards, benchmarks & telemetry | ⬜ not yet explored (Evaluate's Dashboard/Flow tabs partially cover this — see 4.2) |
| `govern` | Govern | Policy, alignment & evidence — across every center | ⬜ partially touched via Alignment (4.1.4) and Policy settings (5.12) |

Each surface in the registry carries a **maturity** flag: `live` (real, wired to a backend), `beta` (works,
rough edges), `soon` (scaffolded, "coming soon" panel, no dead link), `planned` (named gap, not yet built).
And a **tier**: `primary` (shown by default), `secondary` (under a "More" divider), `tab` (folds into another
surface instead of getting its own sidebar row), `hidden`.

---

## 3. Workspace Command Center

*"Chat, canvas, notes & rooms — where the work happens."*

### 3.1 Chat
The core 1:1 conversational surface. (Not yet deep-dived in this session — default landing surface.)

### 3.2 Notes — `components/surfaces/NotesSurface.tsx` · `lib/notes/useNotes.ts`
**Role**: structured knowledge capture — the bridge between "things you write" and Noetica's long-term memory.
- Markdown note editor: title, tags, edit/preview toggle, local-first autosave (debounced), capped at
  `MAX_NOTES` with oldest-unpinned eviction.
- **Per-note embedded chat** — ask questions scoped to that note's content (summarize/extend/critique); the
  exchange is saved as part of the note. Read-only with respect to the note body (chat never edits it).
- **Semantic backlinking** — debounced query to `POST /api/knowledge/link-suggestions` surfaces similar
  existing graph nodes as you type; click to insert a `[[label]]` wiki-link.
- **"Index" button** — explicitly pushes the note into `POST /api/ingest/queue` so "the agent can recall it."
  This is the key link into the Data command center's Knowledge Graph.
- **Notion bridge** — lists your Notion pages inline (read) and can push a local note out as a new Notion page
  (one-way export).

### 3.3 Canvas — `components/surfaces/CanvasSurface.tsx` · `lib/types/canvas.ts`
**Role**: AI-collaborative document surface — same document shape as Notes, but the model can **write into it
directly** via a tool call (*"Write or replace the content of the active canvas document"*), not just discuss
it. Closer to an "Artifacts"-style live co-authoring surface than a personal knowledge tool. Also has manual
bold/italic/markdown-preview affordances.

### 3.4 Collaborate (`cowork`) — `components/surfaces/CoworkSurface.tsx`
**Role**: single-player, ephemeral **task-decomposition pipeline builder** — not a chatroom.
1. Set a free-text **objective** (persisted to `localStorage`).
2. **AI decompose** → model breaks it into 4–7 tasks.
3. Assign each task to one of five fixed personas: **Researcher, Engineer, Analyst, Writer, Reviewer**
   (each with its own system prompt).
4. **Task chaining** (`inputFrom`) — wire one task's output as another's input context; "Run chain" executes
   all assigned tasks in topological order automatically.
5. **Decision log** — timestamped audit trail of every objective/assignment/completion.

### 3.5 Workrooms — `components/surfaces/WorkroomsSurface.tsx`
**Role**: persistent **multi-agent group chat**. Empty-state copy: *"persistent collaboration spaces where you
and specialist agents work together on tasks."*
- Room = shared thread + participant roster (human/agent/system).
- **Agent Dispatch panel** — multi-select several agents from a fixed roster (`AGENT_ARCHETYPES`), describe a
  task, dispatch to all at once; each streams its response back into the shared thread independently.
- Dispatched agents receive the last 20 room messages as context plus their archetype system prompt — so they
  build on prior discussion, not just an isolated task string.
- Dispatch history shows status (`running → done/error`) per agent call.
- **Slack bridge** — real Slack channels appear alongside local rooms (read-only view; reply from Slack).

### 3.6 Projects — `components/surfaces/ProjectsSurface.tsx`
**Role**: full **project-management surface** (Jira/Linear-style), distinct from Collaborate's ephemeral
single-session planning.
- Projects as containers; **Board** (kanban: To Do/In Progress/In Review/Done), **Backlog**, **Sprints**
  (with dates, progress %, start/complete lifecycle), and a read-only **Linear** integration tab.
- Rich work items: type (task/epic/story/bug/spike/milestone), priority, status, tags, full detail panel.
- **Key differentiator — per-project System Prompt**: each project has a settings tab where you write a
  system prompt *"injected at the start of every conversation while this project is active"* — this is what
  actually scopes Chat behavior per-project, similar to Claude.ai Projects.
- Registry placement is explicitly unsettled: `// ? PM — could be its own Build center`.

### 3.7 Documents (`docs`) — `components/surfaces/OfficeViewer.tsx`
**Role**: a local, **offline office-file viewer** — not an authoring tool, contrast with Notes/Canvas.
- `.docx` → rendered with formatting via vendored `docx-preview`; `.xlsx`/`.xls`/`.csv` → rendered as live
  tabbed spreadsheet tables via vendored `SheetJS`. Both fully client-side/offline, no LibreOffice needed.
- `.pptx` and other formats fall back to an optional local LibreOffice conversion path
  (`/api/cap/office-convert`).
- Deliberately parses spreadsheet cells into React-rendered strings rather than using SheetJS's HTML export,
  to avoid an XSS vector in that export path.
- Read-only, single-file, no persistence, no KG indexing. `maturity: beta`; registry also flags its placement
  as unsettled: `// ? office suite — could be Data`.

### 3.8 Calendar
Secondary tier, `maturity: beta`. Not yet deep-dived.

---

## 4. AI · Models Command Center

*"Studio, evaluation, tuning, boards & agents."*

### 4.1 Studio — `components/surfaces/StudioSurface.tsx`
**Role**: an AI-ops workbench — *"the AI-ops workbench Microsoft Foundry / IBM watsonx ship and we lacked."*
Studio itself contains an internal top tab-bar with four sub-tools (all under the `ai` command center, folded
in as `tier: 'tab'` in the registry so they don't get separate sidebar rows):

#### 4.1.1 Prompt & Compare (this *is* the Studio surface)
- **Prompt Workbench** — template editor with `{variable}` placeholders + a JSON values box + model picker +
  temperature slider. Run → `POST /api/cap/prompt-run` (server does the variable substitution). Keeps last 10
  runs as history.
- **Model Compare** — one prompt, multi-select models, `POST /api/cap/model-compare` races them and renders
  outputs + latency side-by-side in a grid.

#### 4.1.2 RAG — `components/surfaces/RagInspectSurface.tsx`
Retrieval-debug screen: *"Where did this come from, and why these chunks?"* Enter a query →
`POST /api/cap/rag-inspect` → shows **Semantic (dense/nomic-embed)** and **Lexical (BM25)** retrieved chunks
side-by-side with per-chunk scores and sources. Purely diagnostic.

#### 4.1.3 Capabilities — `components/surfaces/LabSurface.tsx`
⚠️ **Naming collision**: this is different from the sidebar's "Labs" (§4.4, the model catalog) — same word,
distinct surfaces. A guided, searchable workbench over **~55 on-device capabilities**, grouped by category:
Investigation (entity risk, co-location, hotspots, stay-points, pattern-of-life, isochrones), Reasoning
(provenance proofs, Datalog, defeasible reasoning, rule mining, mind-maps, graph "dreaming", beam traversal),
Safety (prompt-injection detection, trajectory monitoring), Verification (best-of-N, semantic entropy,
self-consistency, conformal abstention, entailment), Retrieval (RRF, hybrid search), Ontology/Standards/
Interop, OpenCog (PageRank, PLN), Causal (DAG path-finding), Compliance (C2PA/EU AI Act credentials), Memory
(salience decay, spaced repetition), Learning, Judgment, Runtime/Deploy/Swarm, CMS/Office/Hardening, Dev/Math.
Pick a capability → get a plain-English description + editable sample JSON payload → Run (⌘/Ctrl+Enter) →
`POST /api/cap/{id}` → formatted result with status + timing. Essentially a built-in, purpose-specific
Postman for the app's own capability library.

#### 4.1.4 Alignment — `components/surfaces/AlignmentSurface.tsx`
*"Does what I just read align with my brain?"* Paste an article/claim → `POST /api/cap/align-check` → each
sentence is checked against your ingested documents + chat history and labeled **Corroborated** / **Conflicting**
/ **Novel**, with the matching source and similarity score, plus an overall alignment score. A personal
fact-checker grounded in your own knowledge base, not the open internet. Links out to the Govern surface via
"View governance posture."

### 4.2 Evaluate — `components/surfaces/EvaluateSurface.tsx`
**Role**: benchmarking and model-quality tracking — *"which model is actually good at what, at what cost, and
is quality improving over time?"*
- **Run** view: pick models × fixed task families (Reasoning, Code generation, Summarization, Tool use,
  Safety/refusal — each with a canonical prompt + scoring rubric) → runs all pairs in parallel → optional
  **LLM-as-judge** scores each output 0–1 against the rubric (JSON `{score,label,reasoning}`) → results matrix,
  click any cell for full detail.
- **Dashboard** view: aggregates persisted results — avg latency, avg judge score, total cost, total
  "tokens egressed" — split local vs. cloud providers. Also shows a **"🧠 Compounding brain"** solve-rate
  chart from `GET /api/metrics/quality`.
- **Flow** view (`FlowAnalytics.tsx`): conversational-flow health telemetry from `GET /api/analytics/flow`
  (fallback rate, grounding rate, intent transitions, top paths) — separate from model quality per se.
- **Dependencies**: `lib/client/noeticaTransport.ts` (run calls), `lib/evidence/ledger-store.ts` (append-only,
  local IndexedDB-backed audit log, capped 2000 entries, shared across the whole app — chat/tool/policy/memory
  events too, not just benchmarks), `lib/pricing/modelPricing.ts` (USD/1M-token table for illustrative
  cost contrast; local = $0 marginal).

### 4.3 Tune & Train — `components/surfaces/TuneSurface.tsx`
**Role**: actual model fine-tuning workflow, using a stronger model as a teacher for a local open-weight
student.
- Teacher = any model; Student **must** be open-weight (`local_capable`) — needed for actual fine-tuning.
- Run a prompt on both → mark preference (teacher "Prefer" / student "Reject") → **Export DPO** as `.jsonl`
  (`{prompt, chosen, rejected, teacher_model, student_model}`) — client-side only, no server call.
- **In-app training**: Teacher type *Blackbox→Whitebox* (behavioral cloning, works with any teacher) or
  *Whitebox→Whitebox* (real KD loss using teacher logits — requires a separate **"Cache teacher logits"** step
  first via `POST /api/tune/teacher-cache`). Configure LoRA rank (1–64) + max steps (1–10000) →
  **Start KD Training** → `POST /api/tune/distill {op:'train',...}` → polls `GET /api/tune/distill?job_id=`
  every 1.5s showing step/loss/progress until done, reporting the saved adapter path.
- Embeds `VoiceTrainer` (voice cloning via **XTTS-v2**, fully local via the on-device voice sidecar on
  `127.0.0.1:8124`) — a bundled but conceptually separate feature.

### 4.4 Labs — `components/surfaces/LabsSurface.tsx`
⚠️ Not to be confused with "Capabilities" (§4.1.3). `maturity: beta`. A **read-only model catalog** — no run
button, no config control, purely informational — reflecting an "Apple-aligned + sourceos-spec-conformant"
routing philosophy: one on-device base model (~3B) + swappable per-lab **LoRA adapters** (SociOS opt-in tuning
labs, the specialized "labs" that layer on the base) + a larger server tier.
- Fetches `GET /api/labs/catalog` from the local agent-machine backend on mount; each `Model` entry carries
  `kind` (base/adapter), `tier` (on-device/edge/server), param count, quantization, plus governance metadata
  (`residencyState`, `cacheTier`, `carryPolicy`, `provider`).
- Renders three fixed sections — **On-device base**, **SociOS lab adapters** (grid), **Server tier** — plus a
  footer stating the routing policy in plain terms: **high sensitivity → on-device**, **medium → edge**,
  **low → server**.
- **Dependency note**: this catalog is *not* the same data source as `config/models` (the static provider list
  Studio/Evaluate/Tune&Train use) — it's a separate, dynamically-fetched, on-device-specific catalog. If the
  backend is unreachable it shows an explicit error ("run under dev:app") rather than an empty list.

### 4.5 Agents ("Agent Builder") — `components/surfaces/AgentBuilderSurface.tsx`
`maturity: beta`. The surface's own on-screen heading is **"Agent Builder"** (sidebar label is just "Agents").
A no-code tool for defining a custom sub-agent — name, description, system prompt, allowed tools, turn budget,
model tier — that becomes dispatchable like a built-in role once saved.
- **Description field** is explicitly noted as helping *"the concierge pick it"* — implying an automatic
  routing layer selects among agents by description, not just manual invocation.
- **Tools** are chosen from a fixed grant-list (`web_search`, `public_data`, `read_file`, `write_file`,
  `edit_file`, `list_directory`, `run_command`, `code_execute`, `render_chart`, `generate_image`, `ocr`,
  `registry_lookup`, `remember`) — but the client-side toggle isn't the real enforcement point: a code comment
  confirms tools are **re-validated server-side against `BUILTIN_TOOLS` at dispatch time**, so a custom agent
  can never grant itself more than the platform allows.
- **Max turns** (1–12, default 4) caps how many steps the agent gets. **Save** → `POST /api/agents`; **edit**
  reloads a saved agent's fields back into the form; **delete** → `DELETE /api/agents?id=...`.
- Right-hand panel lists **"Your agents"** (custom, editable/deletable) and **"Built-in roles"** (read-only,
  server-provided, for reference) side by side.
- Per the header comment, `dispatch_agent` "resolves custom agents first" before falling back to built-ins —
  the same containment/sandbox/governance applies to custom agents as to built-ins.
- **Open question** (see §6): it's unconfirmed whether these custom/built-in agents are the same roster
  Workrooms' Agent Dispatch panel uses, or a separate parallel system.

### 4.6 A/B Boards — *not built*
`maturity: planned, gap: true`. Named placeholder for future A/B testing / frontier leaderboards. Disabled
"soon" row, no component exists.

### 4.7 Model Registry — *not built*
`maturity: planned, gap: true`. Named placeholder referencing "lattice-forge RuntimeAssets." No component
exists.

---

## 5. Settings

12 panels, one file each under `components/settings/panels/`, opened via the sidebar user-menu → Settings.

| # | Panel | File | Displays / Function | Calls |
|---|---|---|---|---|
| 5.1 | **Appearance** | `AppearancePanel.tsx` | Display name, theme picker, sidebar density, font size, assistant typing speed (tokens/sec), default TTS voice | `useSettings()`, `useTheme()` — no network |
| 5.2 | **Models** | `ModelsPanel.tsx` | Local model suite (Ollama roles, pull/download), default model, "Prophet Cloud Mesh" hosted aggregator config, add-a-model (local GGUF or hosted id), masked provider API keys | `GET/POST /api/models`, `POST /api/models/pull`, `config/models` |
| 5.3 | **Runtime** | `RuntimePanel.tsx` | 3-way mode: Standalone / Agent Machine / SourceOS; endpoint URL + live ping status; Time Service endpoint | `GET {agentMachineEndpoint}/api/status` |
| 5.4 | **Connections** | `ConnectionsPanel.tsx` | OAuth account connections: Google, GitHub, Slack, Linear, Notion, Matrix | `lib/auth/providers/*` (`initiate*OAuth`/`exchange*Code`), `/oauth/callback` |
| 5.5 | **Workspace** | `WorkspacePanel.tsx` | "Prophet Workspace" — self-hosted mail (IMAP/SMTP) + calendar (CalDAV) config, explicit Google Workspace replacement | `useSettings()` only — config consumed by Mail/Calendar rail panels |
| 5.6 | **Connectors** (MCP) | `ConnectorsPanel.tsx` | Curated MCP server marketplace (Filesystem, GitHub, Brave Search, Postgres, SQLite…) + custom server add | `useMcp()` hook — different mechanism from Connections (tool servers, not data-source auth) |
| 5.7 | **Memory** | `MemoryPanel.tsx` | Memory scope (Disabled/Session/Project/Global), remembered facts CRUD, semantic index build/status, retention days slider, import from ChatGPT/Gemini/Claude exports | `useMemory()`, `POST /api/memory/import` |
| 5.8 | **Voice** | `VoicePanel.tsx` | TTS provider: Cloned (your own, via Tune&Train's VoiceTrainer) / ElevenLabs / OpenAI / System (macOS); wake-word toggle | `/api/voice/tts`, ElevenLabs API, `/api/tts`, `invokeTauri()` |
| 5.9 | **Fan-out** | `FanoutPanel.tsx` | Multi-select models (grouped by provider) for parallel fan-out sends in Chat; concurrency slider (1–8) | `useSettings()` only |
| 5.10 | **Developer** | `DeveloperPanel.tsx` | API endpoint override, raw SSE event toggle, build info (version/shell/phase), feature flags, diagnostics export | `isTauri()`; export is a client-side JSON download |
| 5.11 | **Organization** | `OrgPanel.tsx` | Workspace identity, single-member list, invite-by-email, plan badge ("Development Preview") | `useIdentity()`; invite is just a `mailto:` link — stub for future real multi-user org |
| 5.12 | **Policy** | `PolicyPanel.tsx` | "Authorization Context" profile: Default/Research/Security/Enterprise/Medical, each mapping to "primes" that shape response caution/depth; Security profile gated behind an explicit attestation statement | `useSettings()` — feeds the same governance system as Alignment's "View governance posture" |

---

## 6. Known Naming Collisions & Open Architectural Questions

Worth flagging so future-you doesn't get confused re-reading the code:

- **"Labs" (§4.4, model catalog) vs. "Capabilities" (§4.1.3, the ~55-capability workbench)** — visually and
  conceptually distinct despite both being about "what the system can do."
- **"Connections" (§5.4, OAuth data-source auth) vs. "Connectors" (§5.6, MCP tool servers)** — same-sounding,
  different underlying mechanism (`lib/auth` vs `lib/mcp`).
- **Labs' catalog (`GET /api/labs/catalog`, §4.4) vs. `config/models` (the static list Studio/Evaluate/
  Tune&Train use)** — two separate model data sources; not confirmed whether/how they reconcile.
- **Agent Builder's custom/built-in roster (§4.5, server-driven via `/api/agents`) vs. Workrooms' fixed
  `AGENT_ARCHETYPES` roster (§3.5, hardcoded client-side in `lib/types/workroom.ts`)** — not confirmed whether
  these are unified at dispatch time or two parallel agent systems. Worth checking in a live app session.
- **Registry placement questions the team hasn't settled** (verbatim code comments):
  - Documents: `// ? office suite — could be Data`
  - Projects: `// ? PM — could be its own Build center`
  - Calendar and Documents are `tier: secondary` under Workspace but conceptually could live in Data.

---

## 7. Not Yet Covered (future sections to build out)

- **Workstation** command center (Source/Code, Deploy, Services, Pipelines, Terminal) — local-first dev tooling.
- **Data** command center (Library, Artifacts, Search, Knowledge Graph, plus planned Enrichment/Canon/Ingestion/Connectors gaps).
- **Cloud · DevSecOps** command center (Scale-Up, Security, Deployments, Cloud Broker, Operate, Computer Use, Platform, Marketplace).
- **Analytics** command center beyond what Evaluate's Dashboard/Flow tabs already cover (Signals/Portfolio demo surfaces, Geo, Telemetry gap).
- **Govern** command center as its own surface (Govern, Alignment's home tier, HolographMe).
- **Chat** itself in detail (only referenced as a dependency of other surfaces so far).
- **Calendar** surface detail.
- The **AGENTS.md** contributor/agent conventions file at the repo root — not yet reviewed.
