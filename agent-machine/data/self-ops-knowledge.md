# Noetica self-operations knowledge

Curated, authoritative runbook + FAQ for operating Noetica itself. This is the differentiator: because
Noetica runs locally on your machine, it can read its own status, update itself, and troubleshoot its own
runtime — a hosted assistant (ChatGPT, Claude) cannot operate or repair the very service you are talking to.
Each `##` section becomes one operations-brain entry.

## How do I update Noetica?
Noetica is distributed as a Homebrew cask. To update to the latest release:
`brew upgrade --cask noetica`
Then quit and relaunch the app so the new version loads. On launch the app loads any missing knowledge
brains automatically — you do not need to download anything by hand. To update the brains too (not just the
app), set `NOETICA_BRAIN_AUTO_UPDATE=1`. Check what you are running at `http://127.0.0.1:8080/api/status`.

## How do I install Noetica for the first time?
`brew tap SocioProphet/noetica https://github.com/SocioProphet/Noetica` then
`brew install --cask noetica`. Launch the app; the agent-machine sidecar starts automatically and, on first
launch, downloads the knowledge brains in the background (a one-time ~2 GB academic download). Watch progress
at `http://127.0.0.1:8080/api/brain/status`.

## What knowledge do I have, and is it loaded? (brain status)
Run: `curl -s http://127.0.0.1:8080/api/brain/status | jq`
It reports each brain — academic (MIT-OCW STEM), operational (this runbook + manpages + stack docs), and chat
(your private conversation memory) — with whether it is present, where it lives, its installed version, the
available version, and whether an update is available. "not provisioned" means it is still downloading or
hasn't been fetched yet.

## My answers have no STEM/academic knowledge — what's wrong?
The academic brain is probably still downloading (it is ~2 GB). Check `/api/brain/status`: if academic shows
`present: false`, it is being fetched in the background — watch the agent-machine logs for `loading academic
brain`. To trigger it manually: `curl -N -X POST http://127.0.0.1:8080/api/brain/provision -d '{"name":"academic"}'`.
If it never loads, your machine may be offline or the manifest URL unreachable.

## How does brain loading work? (the injection + update service)
Brains live in a public bucket behind a small JSON manifest at
`https://storage.googleapis.com/noetica-brains/brains/manifest.json`. On boot the app reads the manifest and
downloads any brain that is absent, verifying its sha256 before installing into `~/.noetica/brains`. This is
on by default. Disable with `NOETICA_BRAIN_AUTO_PROVISION=0`. Point at a different bucket with
`NOETICA_BRAIN_MANIFEST_URL`. Auto-update outdated brains with `NOETICA_BRAIN_AUTO_UPDATE=1`.

## The app won't open — macOS says it is damaged or from an unidentified developer.
This is Gatekeeper quarantine, not a real problem. Run:
`sudo xattr -dr com.apple.quarantine /Applications/Noetica.app`
then open the app again.

## The app is open but nothing responds / the sidecar seems down.
Noetica's brain is the agent-machine sidecar on `http://127.0.0.1:8080`. Check it:
`curl -s http://127.0.0.1:8080/api/status`. If that fails, the sidecar isn't running — quit Noetica fully and
relaunch (the sidecar starts with the app). If port 8080 is already in use, another Noetica instance is
running; quit it first.

## The local model isn't responding / answers are very slow.
Noetica runs a local model via a managed Ollama runtime that is provisioned into `~/.noetica/runtime` on
first boot. If it's missing or broken, check free disk space (the model is several GB) and relaunch so the
runtime re-provisions. Slow first answers are normal while the model loads into memory.

## Where is my data stored?
Everything is under `~/.noetica`:
- `~/.noetica/brains` — the academic + operations knowledge brains (shippable, re-downloadable).
- `~/.noetica/hellgraph` — your private chat brain (conversation memory + knowledge graph). Personal; never
  uploaded or shipped.
- `~/.noetica/runtime` — the local model runtime.
- `~/.noetica/identity.json` — your profile (name/email). A fresh install is nobody until you set this.
Nothing here leaves your machine unless you explicitly enable an integration.

## How do I set who I am (my profile)?
A fresh install shows a neutral profile ("You") until you set yours. In Settings → Organization, or via the
API: `curl -X PUT http://127.0.0.1:8080/api/identity -d '{"displayName":"Ada Lovelace","email":"ada@x.com"}'`.
You can also set `NOETICA_USER_NAME` / `NOETICA_USER_EMAIL`.

## How do I reset Noetica / start clean?
Quit the app. To wipe everything (including your chat memory): `rm -rf ~/.noetica` — it will rebuild on next
launch. To re-download just the brains: delete `~/.noetica/brains` and relaunch (they re-provision). To fully
uninstall: `brew uninstall --cask noetica --zap` (the `--zap` also removes `~/.noetica`).

## What are the main configuration flags?
- `NOETICA_BRAIN_AUTO_PROVISION` — auto-load absent brains on boot (default on; `0` disables).
- `NOETICA_BRAIN_AUTO_UPDATE` — auto-update brains when a newer version is published (`1` to enable).
- `NOETICA_BRAIN_MANIFEST_URL` — point at a different brain bucket/manifest.
- `NOETICA_USER_NAME` / `NOETICA_USER_EMAIL` — your identity.
- `NOETICA_ORIGIN_GUARD=0` — disable the cross-origin request guard (only if a local tool needs it).
- `NOETICA_EFFORT_GATE=0` — disable the trivial-request lightening (force full deliberation always).

## How do I check the agent's routing / why it answered the way it did?
Set `NOETICA_ROUTING_LOG=1` to record per-turn routing decisions (intent, domain, effort tier) to
`~/.noetica/routing-decisions.jsonl`, then review with `curl -s http://127.0.0.1:8080/api/routing/log | jq`.
Queries are not recorded unless you enable this.

## What is the difference between the three brains?
- Academic: curated MIT-OpenCourseWare STEM knowledge (math, physics, chemistry, biology, EECS, …) — dense
  vector retrieval. Shipped, read-only.
- Operational: how to run and troubleshoot Noetica and the SocioProphet/SourceOS/SociOS stack — this runbook,
  command manpages, and stack docs. Lexical retrieval. Shipped, read-only.
- Chat: your own conversations and the knowledge graph built from them — private, per-user, never shipped.
They are separate stores, so your private chat can never contaminate the shipped knowledge and vice-versa.

## Why can Noetica help operate itself when ChatGPT or Claude can't?
ChatGPT and Claude are hosted services running on someone else's servers — they can describe software in the
abstract, but they cannot read your install's status, see your logs, fetch your knowledge, or update their own
runtime, because that runtime isn't on your machine. Noetica runs locally: the same agent that answers you can
query `/api/brain/status`, trigger a brain download, read `~/.noetica`, and tell you exactly how to update or
repair the very instance you are using. It operates itself.
