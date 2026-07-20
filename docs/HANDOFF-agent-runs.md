# Handoff — Agent Runs (Dispatch + Routines) & interface pass

_Last updated 2026-07-20. Written at a session handoff (credits running low)._

## What this covers
A multi-session sweep on the Noetica desktop app: a Tufte-minimal interface pass, a voice
split + live "metachat", an emoji purge, and a new **agent-runs** capability (Dispatch +
Routines). This note is the pick-up point for whoever continues.

## Merged to `main` (shipped)
- **#518** escapable onboarding (backdrop/✕/Esc) + kill topbar/chat emoji
- **#519** voice split — dictate → composer (bottom bar); live conversation → top (waveform)
- **#520** stop the last answer replaying its typewriter on window refocus
- **#521** metachat lane — live conversation gets its own transcript (right-rail **Live** panel) +
  "commit to chat"
- **#522** strip colorful emoji from the chat flow (dialogue easter eggs, BuildCard, placeholder)
- **#525** **agent-runs Phases 0–2** — the new feature (see below)

## Agent runs — what's built (#525)
- **Phase 0 (spine, agent-machine):** `agent-machine/lib/agent-runs.ts` (encrypted-at-rest
  `AgentRun` + `Routine` stores, schedule math, due selection). `server.ts`: `executeRun`
  (drives `runSubAgent` as a top-level persisted job; respects cancel), routes
  `GET/POST /api/runs`, `GET/POST /api/runs/:id[/cancel]`, `GET/POST /api/routines`,
  `DELETE /api/routines/:id`, and a 60s `tickRoutines` scheduler in `server.listen`
  (`NOETICA_ROUTINES=0` disables). Runs use **local models** (no cloud keys).
- **Phase 1 (Dispatch):** `components/surfaces/DispatchSurface.tsx` — launch a background agent
  (prompt + role), poll runs, view result, cancel, **Send to chat** (`noetica:run-to-chat`
  event → `AppShell` appends to transcript).
- **Phase 2 (Routines):** `components/surfaces/RoutinesSurface.tsx` — hourly/daily/weekly
  builder, enable/pause, delete.
- Registered in the **AI · Models** center (`lib/types/surface.ts`, `commandCenters.ts`,
  `AppShell.tsx` — workspace-mode map + `CenterWorkspace` switch + run-to-chat listener).

## Phase 3 — Customize sidebar (DONE)
Reorder + hide the command centers in the rail, persisted.
- `lib/nav/navPrefs.ts` — `loadNavPrefs`/`saveNavPrefs` (localStorage `noetica:navprefs`, fires
  `noetica:navprefs-changed`) + `applyCenterPrefs(all, prefs)` (order + hide).
- `components/shell/CustomizeSidebarModal.tsx` — list, per-row show/hide toggle + up/down
  reorder, live-persists; `workspace` is non-hideable.
- `components/shell/CommandCenterRail.tsx` — reads prefs, re-reads on `noetica:navprefs-changed`,
  renders `applyCenterPrefs(COMMAND_CENTERS, prefs)`, and has a **Customize** button at the
  bottom. Also listens for `noetica:customize-sidebar` so other surfaces can open it.
- Verified live (DOM): hide removes a center from the rail instantly; modal opens on the event.
- **Still optional:** a "Customize sidebar" item in the Sidebar ⋮ quick-access menu
  (`components/shell/Sidebar.tsx`) that dispatches `noetica:customize-sidebar`.

## In-flight (independent)
- **Nightly build** dispatched off `main` for #525 — check `gh run list --workflow nightly.yml`;
  when the release publishes, `brew upgrade --cask noetica-nightly`.
- **Emoji surface-sweep** task running in a separate session (Govern/Marketplace/Deploy/etc.
  pictographs → SVG/text). Its PR should be folded into a later build.

## Open follow-ups / decisions
- **#517 Tufte gutter** — provenance sidenotes in the right margin. Built, verified geometry,
  **OPEN, not merged** — awaiting a live look before merge (user wanted to see it first).
- **Routines daemon:** v1 fires only while the app (sidecar) runs. An always-on daemon is a
  later step (surfaced honestly in the UI).
- **Live run streaming:** Dispatch v1 polls; `runSubAgent` is headless. Live token streaming
  for runs is a follow-up.
- **Verification gap:** live metachat + agent runs hit the model, so they can't be exercised in
  the dev-preview browser (cross-site origin guard blocks `:8080` writes). They exercise in the
  **packaged build** — test there.

## Build / deploy quickref
- Rebuild: `gh workflow run nightly.yml` (pushes a `v*-nightly.*` tag → `release.yml` builds the
  universal DMG + publishes the cask, ~34 min). Skips if `main` has no new commits.
- Frontend typecheck: `npx tsc --noEmit -p tsconfig.json`. Backend: `cd agent-machine && npx tsc --noEmit`.
- Static export: frontend is baked at release; sidecar changes need a rebuild to ship
  (hot-swap only updates the sidecar).
