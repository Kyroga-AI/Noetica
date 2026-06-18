# Noetica demo runbook

Operational checklist for running a reliable local-first demo. All commands assume
a working Ollama (system on `:11434` or the bundled one) with the model suite pulled.

## 0. One-command readiness check (always run this first)
```sh
cd agent-machine && npm run predemo
```
Green = agent-machine up, Ollama generating, routing picks a capable model (not the
3B), and document RAG round-trips. Red lines tell you exactly what to fix.

## 1. Today / dev: run the latest code without rebuilding
The installed app's UI just talks to `http://127.0.0.1:8080`. To point it at your
local source (e.g. to use fixes not yet in a nightly):
```sh
cd agent-machine && npm run dev:backend         # kills the bundled sidecar, runs source on :8080
# Ollama target + prewarm are configurable:
OLLAMA_HOST=http://127.0.0.1:11435 NOETICA_PREWARM_MODELS="qwen2.5:7b,deepseek-r1:8b" npm run dev:backend
```

## 2. Tomorrow / release: update the app
```sh
brew update && brew upgrade --cask noetica-nightly
xattr -dr com.apple.quarantine /Applications/Noetica.app   # if Gatekeeper blocks (ad-hoc signed)
open -a Noetica
```

## 3. Resilience built in (you usually don't touch these)
- **Ollama fallback** — if the bundled Ollama can't run inference (missing runner)
  or is unreachable, the agent-machine auto-falls back to a system Ollama. A
  persistent fallback runs on `:11434` via a LaunchAgent
  (`~/Library/LaunchAgents/ai.socioprophet.noetica-ollama-fallback.plist`).
- **RocksDB store** — opt in with `HELLGRAPH_BACKEND=rocksdb` (aligned to OpenCog
  atomspace-rocks); defaults to JSONL otherwise.
- **Model pre-warm** — `NOETICA_PREWARM_MODELS` loads models into RAM (keep_alive
  30m) so the first query isn't a cold-load stall.

## 4. Documents (RAG)
Upload `.docx` / `.pdf` / text in chat (server extracts + embeds + stores), then ask
about it — answers cite the source `[n]`. Re-uploading identical content is a no-op
(content-addressed). PDFs must contain real text (scanned/image PDFs are rejected
with a clear message).

## 5. If something's wrong
| Symptom | Check |
|---|---|
| "No local Ollama runtime" | `curl localhost:11434/api/tags` and `localhost:11435/api/tags`; start one |
| Frozen / 500 on every answer | bundled Ollama missing its runner → fallback should kick in; `npm run dev:backend` to use source |
| Answers from the weak 3B | `npm run predemo` flags it; routing should pick qwen2.5:7b for substantive Qs |
| Doc not used in answers | re-upload; check `npm run predemo` RAG line; embed model present (`ollama pull nomic-embed-text`) |
