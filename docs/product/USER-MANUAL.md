# Noetica — User Manual

> Living document. Started 2026-07-16 from a code-grounded Q&A session covering the Workspace and AI·Models
> command centers plus Settings. Updated 2026-07-16 with deeper detail on Labs (§4.4) and Agent Builder (§4.5).
> Updated again 2026-07-17 with expanded Notes/Canvas/Collaborate/Workrooms/Projects sections (§3.2–3.6) — added
> dependency detail, explicit "vs. Chat" framing, persistence-mechanism specifics, and several verified
> discrepancies (Notes' indexing fix in PR #479, Canvas's dead event listener, CoworkPanel's disconnected static
> rail widget, Workrooms' Video tab not actually linked to the active room, Projects' lack of any team/sharing
> support). Every claim below was verified against the actual component source at the time of writing — not the
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
**vs. Chat**: Chat's AI does the work (tools, MCP, fanout); a note's embedded chat only *talks about* a fixed
piece of your own writing and can never edit it — you're the author, the model is a sounding board.
- Markdown note editor: title, tags, edit/preview toggle, autosave (debounced 600ms), capped at
  `MAX_NOTES` (500) with oldest-unpinned eviction.
- **Persistence**: `@tauri-apps/plugin-store` (`noetica-notes.json`) in the desktop app, `localStorage`
  fallback in-browser — platform-aware, unlike Canvas which is always localStorage.
- **Per-note embedded chat** — ask questions scoped to that note's content (summarize/extend/critique); the
  exchange is saved as part of the note (`note.messages`), so it survives reload — unlike Canvas's chat, which
  is in-memory only. **No tools are registered** — read-only with respect to the note body.
- **Semantic backlinking** — debounced query to `POST /api/knowledge/link-suggestions` surfaces similar
  existing graph nodes as you type; click to insert a `[[label]]` wiki-link.
- **"Index" button — a note is NOT in the knowledge graph by default.** Clicking it pushes `# title\n\nbody`
  through `POST /api/ingest/queue` with `collection: "notes"`, which registers a dedicated, named **"Notes"**
  collection (same pattern the built-in "Inbox" catch-all follows) so indexed notes get a visible, labeled
  group in the Library/Knowledge Graph view. Ingestion is async — the frontend polls `/api/ingest/status`
  until the job actually reports `done` before recording `indexedDocId`/`indexedAt`/`indexedSnapshot` on the
  note, and the button reflects genuine state: **Index → Indexing… → Indexed Xh ago → Re-index** (amber, shown
  once the note's content has changed since its last index) **→ Index failed** (red). Re-indexing an edited
  note hides the prior content-hashed document instead of leaving it as an orphaned duplicate. *(This full
  mechanism — dedicated collection + honest completion state + no-orphan re-index — landed in
  [PR #479](https://github.com/SocioProphet/Noetica/pull/479); earlier builds silently dumped indexed notes
  into the generic Inbox with only a 4-second toast as feedback.)*
- **Notion bridge** — lists your Notion pages inline (read) and can push a local note out as a new Notion page
  (one-way export).
- **Not connected to the graph**: Chat and Canvas do not feed the knowledge graph this way — Canvas documents
  are never ingested at all, and regular Chat conversations use a separate episodic-memory mechanism, not
  document ingestion. There's also no reverse link yet from a Library/Knowledge-Graph row back to its source
  Note (would need a `sourceNoteId`-style field on the Document node).

### 3.3 Canvas — `components/surfaces/CanvasSurface.tsx` · `lib/types/canvas.ts`
**Role**: AI-collaborative document surface — same document shape as Notes, but the model can **write into it
directly** via a `canvas_write` tool call (*"Write or replace the content of the active canvas document"*), not
just discuss it. Closer to an "Artifacts"-style live co-authoring surface than a personal knowledge tool. Also
has manual bold/italic/markdown-preview affordances.
**vs. Chat**: same shared chat transport, but scoped per-document (`session_id: canvas:<id>`) with one extra
tool the model can call to overwrite the doc in place — you're not reading a reply and copy-pasting it, the
document just updates live as the model streams.
- **Persistence**: always `localStorage` (not platform-aware like Notes/Workrooms), debounced 500ms.
- **Chat history is ephemeral** — kept in a `Map` in component state, not persisted with the document; refresh
  the app and the document survives but the conversation that produced it doesn't.
- **Not connected to the knowledge graph at all** — no Index button, no ingestion path. A pure sandbox scratchpad.
- ⚠️ **Dead code note**: `lib/canvas/useCanvas.ts` still listens for a global `noetica:canvas:write` custom
  event ("from the AI tool" per its comment), but nothing in the current codebase dispatches that event — the
  real write path is `CanvasSurface`'s direct `onDocUpdate()` call after a tool-call response. Looks like a
  leftover from an earlier design, not currently reachable.

### 3.4 Collaborate (`cowork`) — `components/surfaces/CoworkSurface.tsx`
**Role**: single-player, ephemeral **task-decomposition pipeline builder** — not a chatroom.
**vs. Chat**: no ongoing conversation at all — each task "Run" is one independent, stateless model call
(persona system prompt + objective + optionally one chained predecessor's result). You can't follow up on a
task's output; you can only re-run it or chain a new task from it.
1. Set a free-text **objective** — the *entire* state (`objective` + `tasks` + `decisions`) is one flat blob in
   `localStorage` under `noetica:cowork:v1`. Unlike Notes/Canvas/Workrooms, there's only **one active session at
   a time** — "New session" destroys it (with a confirm dialog) rather than archiving and switching.
2. **AI decompose** → model breaks it into 4–7 tasks.
3. Assign each task to one of five fixed personas: **Researcher, Engineer, Analyst, Writer, Reviewer**
   (each with its own system prompt) — a *different* five-persona roster from Workrooms' `AGENT_ARCHETYPES`.
4. **Task chaining** (`inputFrom`) — wire one task's output as another's input context; "Run chain" executes
   all assigned tasks in topological order automatically.
5. **Decision log** — timestamped audit trail of every objective/assignment/completion.
6. **Not connected to the knowledge graph** — task results are ephemeral text in that one localStorage blob;
   nothing here is ingested or indexed.
7. ⚠️ **Disconnected right-hand panel**: `components/panels/CoworkPanel.tsx` (rendered alongside this surface)
   is a **static, hardcoded placeholder** — "Participants: No agents or users assigned yet," every status count
   shown as 0 — regardless of the actual task board state. It's not wired to `CoworkSurface` at all, and the
   same static panel is also reused (oddly) for the unrelated `projects` surface's right rail.

### 3.5 Workrooms — `components/surfaces/WorkroomsSurface.tsx`
**Role**: persistent **multi-agent group chat**. Empty-state copy: *"persistent collaboration spaces where you
and specialist agents work together on tasks."* Sidebar label is "Workrooms" — note the nav registry's
"Collaborate" label belongs to the *different* `cowork` surface (§3.4); don't conflate the two despite the
similar theme.
**vs. Chat**: a room holds *multiple* named, simultaneously-present participants (you + any number of agent
archetypes) rather than a 1:1 conversation, and **typing a message does not itself trigger a model response**
— only an explicit "Dispatch" does. It reads like a group chat, but the model only speaks when directly
addressed.
- Room = shared thread + participant roster (human/agent/system). Persisted like Notes (`@tauri-apps/plugin-store`
  → `noetica-workrooms.json`, or `localStorage` fallback), capped at `MAX_WORKROOMS` (100).
- **Agent Dispatch panel** — multi-select several agents from a fixed roster (`AGENT_ARCHETYPES`: Research,
  Code Review, Planner, Writer, Analyst — a *different* five-persona set from Collaborate's), describe a task,
  dispatch to all at once **in parallel** (not sequenced); each streams its response back into the shared
  thread independently.
- Dispatched agents receive the last 20 room messages as context plus their archetype system prompt — so they
  build on prior discussion, not just an isolated task string. This is the key structural difference from
  Collaborate's task runs, which never see a shared transcript, only the objective and one optional chained
  predecessor.
- Dispatch history shows status (`running → done/error`) per agent call.
- **Slack bridge** — real Slack channels appear alongside local rooms (read-only view; reply from Slack).
- **Video tab** (`jitsi`, folds into this surface's nav group) — embeds the Jitsi Meet IFrame API (default
  `meet.jit.si`, or a configurable self-hosted domain). ⚠️ **Not actually wired to the active Workroom** — you
  manually type or randomly generate a call room name; there's no automatic link between "the Workroom you have
  open" and "the video call you start." They just share a navigation group.
- **Not connected to the knowledge graph** — like Collaborate, nothing here is auto-ingested.

### 3.6 Projects — `components/projects/ProjectsPanel.tsx` (⚠️ NOT `ProjectsSurface.tsx` — see below)
**Role**: what's actually live is a **project-configuration surface**, not the full PM tool the name suggests —
distinct from Collaborate's ephemeral single-session planning.
**vs. Chat**: Projects has **no chat interface of its own at all**. It doesn't hold conversations; instead, one
project can be globally "active" (`activeProjectId`, a single app-wide value, not per-session), and while
active, its system prompt + attached files silently attach to *whatever chat you have open* — Projects is a
togglable preset for Chat, not a place you work in directly.
- ⚠️ **`ProjectsSurface.tsx` (49KB) is dead code — imported in `AppShell.tsx` but never rendered anywhere.**
  It's a genuinely rich, fully-built Jira/Linear-style tool: kanban **Board** (To Do/In Progress/In
  Review/Done), **Backlog**, **Sprints** (dates, progress %, lifecycle), a read-only **Linear** integration
  tab, and rich work items (type/priority/status/tags/detail panel). None of it is reachable in the running
  app — `activeSurface === 'projects'` renders `ProjectsPanel.tsx` instead, which is a completely different,
  much simpler component (list of projects + a 3-tab editor: System Prompt / Files / Settings — no board, no
  backlog, no sprints). *Confirmed via direct grep of `AppShell.tsx` — `ProjectsSurface` has exactly one
  reference (its own `import`) in the whole file.* Worth flagging to whoever owns this surface: either wire
  `ProjectsSurface` in (and decide what happens to `ProjectsPanel`'s config role), or remove the dead file.
- What you **actually get** today: a per-project system prompt, small file attachments, and an activate/
  deactivate toggle — described below.
- ⚠️ `components/panels/CoworkPanel.tsx` (the disconnected static widget from §3.4) is also reused as this
  surface's right-rail panel — unrelated to the Projects content itself.
- **Key differentiator — per-project System Prompt**: each project has a settings tab where you write a
  system prompt *"injected at the start of every conversation while this project is active"* — this is what
  actually scopes Chat behavior per-project, similar to Claude.ai Projects. **Persistence is always
  `localStorage`** (like Canvas, not platform-aware like Notes/Workrooms).
- **Two distinct attachment mechanisms, easy to conflate**: (1) `fileAttachments` on the Project record itself
  — small files stored base64 directly on the project, injected raw into every conversation while active, no
  chunking/embedding; vs. (2) documents uploaded *during a chat* while the project is active, which get
  properly ingested into a dedicated, isolated graph collection (`projectCollectionId()` → `proj-<12 hex
  chars>`) — real chunked/embedded RAG, scoped so it never mixes with other projects' or the general Inbox's
  documents. A per-message **retrieval-scope selector** (`chat` / `project` / `everything`) lets you choose how
  wide a net that turn's retrieval casts.
- **No team/collaborator support** — confirmed via the `Project` type (`id, title, color, description,
  systemPrompt, fileAttachments, createdAt, updatedAt, pinned?`): no `participants`/`members`/`sharedWith`
  field, and the whole store is `localStorage`-only on one device with no backend project entity to share in
  the first place. Structurally quite different from Claude.ai's Projects, which are folders holding *multiple*
  conversations and (on Team/Enterprise) can be shared with teammates — Noetica's Projects is a single-user,
  single-device preset, not an organizational container.
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
- **Two entirely different five-persona rosters** exist for near-identical purposes: Collaborate's
  `AGENT_PERSONAS` (Researcher/Engineer/Analyst/Writer/Reviewer, §3.4) and Workrooms' `AGENT_ARCHETYPES`
  (Research/Code Review/Planner/Writer/Analyst, §3.5) — different names, different system prompts, no shared
  definition. Plus Agent Builder's separate server-driven roster above — three parallel "who can I dispatch to"
  systems in the app.
- **"Collaborate" (sidebar label, §3.4, the `cowork` surface/task-decomposition board) vs. "Workrooms"
  (§3.5, the persistent multi-agent group-chat surface)** — easy to conflate given both are about working
  with multiple AI personas, but structurally unrelated (single ephemeral session vs. many persistent named
  rooms; sequential/chained task runs vs. parallel dispatch into a shared transcript).
- **`CoworkPanel.tsx` (`components/panels/`) is a static, hardcoded placeholder** reused as the right-rail
  widget for *both* the Collaborate (§3.4) and Projects (§3.6) surfaces — it shows "0 participants / 0 for
  every status" regardless of either surface's actual live state. Not wired to either one.
- **Canvas's `noetica:canvas:write` global event listener (§3.3) appears to be dead code** — nothing in the
  current codebase dispatches it; the real AI-write path is a direct method call, not this event.
- **Workrooms' Video tab (§3.5) is not actually linked to the active Workroom** — it's a generic Jitsi embed
  under the same nav group, with a manually-typed/random room name, no automatic connection to which room
  you have open.
- **`ProjectsSurface.tsx` (§3.6) — a fully-built 49KB Jira/Linear-style tool (kanban board, backlog, sprints,
  Linear integration) — is imported in `AppShell.tsx` but never rendered.** The live "Projects" surface is the
  much simpler `ProjectsPanel.tsx` (system prompt / files / settings only). The most significant single
  discrepancy found while writing this manual — worth resolving one way or the other rather than leaving a
  49KB unreachable component in the tree.
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
