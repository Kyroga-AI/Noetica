# Verify Pass — Academy v3 + gated surfaces (against a real DMG)

**Purpose:** everything in PR #534 (Academy v3) and the recent gated surfaces has been type-checked but **never run for real**. Academy/learning endpoints only populate in the **packaged build** — in dev, `amUrl()` returns a *relative* path (no `:8080` sidecar), so the surfaces render but calls no-op. This checklist drives the real flows once a DMG is installed.

**Why a DMG, not dev:** `lib/tauri/bridge.ts` → `amUrl(p)` = `http://127.0.0.1:8080${p}` **only under Tauri**; in a browser it's just `p`. The agent-machine sidecar (`:8080`) and managed Ollama (`:11435`) only come up in the packaged app. See [[hot-swap-vs-release]]: hot-swap updates ONLY the sidecar — the frontend is a static export baked at release, so a UI fix is NOT live until a full release build.

## 0. Preconditions

- [ ] Build + install the DMG (`deploy.sh` / release pipeline — see [[noetica-release-pipeline]]).
- [ ] App launches; sidecar reachable: `curl -s localhost:8080/api/health` (or any GET below) returns JSON, not a connection refusal.
- [ ] Models present: `curl -s localhost:11435/api/tags` lists `qwen3:14b` (the workhorse). Router upgrade needs RAM — see [[noetica-model-suite]].
- [ ] Seed learners exist: `ls agent-machine/academy/learners/` → `demo.json` (Ada/degree), `demo-k12.json` (Theo/K-12), `demo-pro.json` (professional).

> Backend checks below can run headless with `curl localhost:8080/...`; the UI-column steps need the app window. Do both — a green curl with a broken UI still fails the pass.

---

## 1. Academy — Learn tab

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Type "linear algebra" → Chart the path | `POST /api/learn/path {goal}` | numbered prerequisite ladder, foundations first, level labels | |
| Click "Learn →" on a step | (client `noetica:ask` event) | tutor prompt lands in Chat, Socratic framing | |
| Try a nonsense goal ("asdf") | same | graceful "No path to that yet" empty state, no crash | |

Smoke: `curl -s localhost:8080/api/learn/path -XPOST -H 'content-type: application/json' -d '{"goal":"linear algebra"}' | jq '.path | length'` → > 0

## 2. Academy — Practice tab (SRS)

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Open Practice | `GET /api/learning/srs/due` | a due flashcard (or honest "nothing due") | |
| Flip → grade Again/Hard/Good/Easy | `POST /api/learning/srs/review {grade}` | advances to next card; grade persists | |
| On a card: "Re-teach this with the tutor →" | (client `noetica:ask`) | first-principles re-teach prompt in Chat | |

## 3. Academy — Lecture tab (audio overview + call-in) — HIGHEST RISK

Reuses `AudioOverviewPlayer`. Needs the TTS voice sidecar (XTTS-v2, macOS today — see [[noetica-voice-cloning]]) and STT.

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Open Lecture → generate | `POST /api/study/audio-overview` | two-voice audio is produced and plays | |
| Press call-in, ask a question | `POST /api/stt` then `POST /api/study/audio-overview/callin` | question transcribed; spoken answer resumes lecture | |
| No material added yet | same | honest empty/disabled state, no console error | |

⚠️ Verify the voice sidecar actually provisioned (uv py3.11). If TTS is macOS-only, note Linux gap ([[noetica-linux-portability]]).

## 4. Academy — Reference tab (canon lookup)

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Look up "eigenvalue" (kind: definition) | `GET /api/canon?q=&kind=` | authored definition + canonical equations + related chips | |
| Click a related chip | (client `noetica:ask`) | tutor prompt in Chat | |
| Look up gibberish | same | "Not in the canon yet" empty state | |

## 5. Academy — Canon tab (OCW ingestion + visible license gate) — NEW, verify governance

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Fill course/title, license `CC BY-SA 4.0`, paste content → **Characterize** | `POST /api/learn/ocw-to-pdor {resource}` | verdict = **Open brain**, green dot | |
| Change license to `CC BY-NC-SA 4.0`, re-characterize | same | verdict = **Commons only** | |
| Change license to `CC BY-ND` (or blank/junk) | same | verdict = **Segmented (fail-closed)**, button reads "Add to private canon anyway" | |
| Click **Add to canon** | `POST /api/ingest/document {content,filename}` | "Added ✓", chunk count; appears in "Added this session" | |
| Confirm it's retrievable | ask a question in Chat that the pasted content answers | the ingested material is cited | |

Smoke the gate directly (this is the moat — verify it can't be fooled): `curl -s localhost:8080/api/learn/ocw-to-pdor -XPOST -H 'content-type: application/json' -d '{"resource":{"course":"x","title":"t","license":"Created by John Doe","content":"y"}}' | jq '.pdor.license.type'` → **`"unknown"`** (a bare "by" must NOT promote to cc-by).

## 6. Academy — Progress tab + Sovereign transcript (offline-verifiable)

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Open Progress | `GET /api/learning/progress?id=local` | brief in the right lens (or honest empty) | |
| Click **Seal transcript** | `POST /api/proof/export` | downloads `noetica-transcript-*.json` | |
| **Verify offline** | `POST /api/proof/verify` with the file | verifies TRUE; then flip one byte → verifies FALSE | |

This is the cloud+local seam — the whole point is it verifies with the app closed. Confirm the downloaded JSON is self-contained (sealed answer + signature), no server round-trip needed to check it.

## 7. Guardian — parent/admin cockpit + roster

| Step | Endpoint | Expected | ✅/❌ |
|---|---|---|---|
| Open Guardian (Data center → Guardian) | `GET /api/learning/learners` | roster chips: Ada·Degree, Theo·K-12, … | |
| Click between learners | `GET /api/learning/progress?id=<sel>` | "Where <name> is" brief swaps per learner | |
| Read tiles | `GET /api/learning/srs/due`, `/api/learning/stats` | due/skills/sessions counts; labelled device-wide | |
| "Start a live session with a coach →" | (client `noetica:navigate` → workrooms) | navigates to Workrooms (socioprophet cohort seam) | |

Smoke: `curl -s localhost:8080/api/learning/learners | jq '.learners[].name'` → the seed learners.

---

## 8. Other gated surfaces (same DMG session)

- **Dispatch + Routines** (#525): open both; start a background run in Dispatch; confirm a Routine schedules. NOTE the still-deferred piece — the **always-on Routines daemon + live run streaming** is backend/Tauri and won't show live progress until built.
- **best-of-N / verifier→selection** (#529, Bet A): ask a hard reasoning question; confirm best-of-N engages on hard turns (toggle at `GET/POST /api/settings` `bonEnabled`). Verify it doesn't fire on trivial turns (latency).
- **metachat lane**: exercise it; confirm no refusal regression on general knowledge ([[noetica-chat-refusal-and-oom]] — self-model docs once polluted the user store).
- **Typed actions** (#531, Bet C v1): open Actions surface; confirm the catalog renders. Per-action approve/undo UX (Bet C phase 2) is NOT built — don't expect it.

## 9. Known gotchas to watch (from prior incidents)

- **Dev origin guard** — if a surface is blank, confirm you're on the DMG, not a dev browser tab. Relative `amUrl` = no sidecar = expected blank in dev.
- **Encryption-at-rest keychain** — hardware keychain path ships **disabled** until the release is code-signed/notarized ([[noetica-security-posture]]); at-rest is software AES until then. Not a bug in this pass, but note it.
- **Fast-Refresh crash** — a module-const referencing later-declared components crashes the whole shell in dev only; prod hoists fine ([[noetica-academy]]). If the shell is blank in dev but fine in the DMG, this is why.
- **Idle OOM** — long `keep_alive` pins models and can OOM on idle ([[noetica-chat-refusal-and-oom]]). Watch memory across a long verify session.

## Outcome

Record pass/fail per row. Any ❌ that isn't "expected empty state" → file against the relevant PR (#534 for Academy/Guardian). The gated-but-unbuilt items (Routines daemon, Bet C phase 2, live cohorts) are out of scope for this pass — they're tracked separately.
