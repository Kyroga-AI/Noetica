# Noetica Quickstart — zero to chatting

One command. From a clean machine to a running, local-first AI you can chat with.

```bash
bash scripts/install.sh
```

That's it. The installer is idempotent — re-run it any time, it only does what's missing.

## What it does

1. **Preflight** — checks your OS and `git` / `node ≥ 20` / `curl`, printing the exact install hint for anything missing.
2. **Ollama** — installs Ollama if you don't have it, starts the daemon, and pulls a sensible default model (`qwen2.5:7b`) plus embeddings (`nomic-embed-text`).
3. **Dependencies** — `npm install` for the app and the `agent-machine` backend.
4. **Brain** *(optional)* — offers to fetch a default brain from `gs://noetica-brains` **if** `gcloud` is installed and authed. If it isn't, it skips cleanly — verified-compute and reasoning work with no brain at all; only retrieval needs one.
5. **Launch** — starts the headless `agent-machine` backend on `:8080` and health-checks `http://localhost:8080/api/status`.
6. **Done** — prints the URL and a ready-to-paste chat command.

## Flags

```bash
bash scripts/install.sh --small      # smaller model (llama3.2:3b) for low-RAM boxes
bash scripts/install.sh --no-brain   # skip the optional brain fetch
bash scripts/install.sh --no-input   # never prompt (auto in CI / non-TTY)
bash scripts/install.sh --help       # full usage

NOETICA_MODEL=qwen2.5:14b bash scripts/install.sh   # pick any Ollama model
NOETICA_AM_PORT=9090       bash scripts/install.sh   # change the backend port
```

## Chat

Once it's up, talk to the backend directly:

```bash
curl -N http://localhost:8080/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"What is 17 * 23, and prove it?"}]}'
```

Responses stream back as Server-Sent Events. The Tauri desktop app (the GUI) talks to this same backend — run the installer once and the app picks it up.

## The one thing nobody else does

Noetica is **the only local AI that proves its computed answers.** Every other local-AI and RAG system — Open WebUI, AnythingLLM, Jan, GPT4All, NotebookLM, Perplexity — shows you *where text came from*. None of them can show that an answer is *correct*. Grounding is not verification. That gap is structural, and it's ours alone.

See [`docs/COMPETITIVE.md`](docs/COMPETITIVE.md) for the honest head-to-head.
