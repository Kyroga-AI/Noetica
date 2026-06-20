#!/bin/bash
# setup-new-mac — run this ON the new M2 Pro to install the toolchain the grind needs,
# BEFORE running migrate (for code) and after (to build deps + pull models). Idempotent.
set -u
echo "# setup-new-mac — toolchain for the OCW capture/vectorize/agent pipeline"

# 1) Homebrew (if missing)
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2) Runtimes: node (via mise or brew), python deps, ollama, rsync/curl/unzip (built-in on mac)
command -v node >/dev/null || brew install node
command -v ollama >/dev/null || brew install ollama
command -v python3 >/dev/null || brew install python3
python3 -m pip install --user --quiet pypdf sympy numpy scipy 2>/dev/null || pip3 install --break-system-packages --quiet pypdf sympy numpy scipy

# 3) Ollama models (re-pull fresh — faster than copying 28GB, no corruption risk)
( ollama serve >/tmp/ollama.log 2>&1 & ) ; sleep 3
for m in nomic-embed-text llama3.2:3b qwen2.5:7b; do
  echo "  pulling $m …"; ollama pull "$m" || echo "  (pull $m failed — retry later)"
done

# 4) Build deps in the repos (after migrate has copied the source)
if [ -d "$HOME/dev/hellgraph" ]; then ( cd "$HOME/dev/hellgraph" && npm install && npm run build ); fi
if [ -d "$HOME/dev/Noetica/agent-machine" ]; then ( cd "$HOME/dev/Noetica/agent-machine" && npm install ); fi
if [ -d "$HOME/dev/Noetica" ]; then ( cd "$HOME/dev/Noetica" && npm install ); fi

# 5) CRITICAL: sync our locally-built hellgraph (semantic module, etc.) into EVERY
#    installed copy under Noetica — npm install pulls the published hellgraph, which
#    lacks our changes. Both Noetica root + agent-machine have their own copy.
if [ -d "$HOME/dev/hellgraph/ts/dist" ]; then
  for d in $(find "$HOME/dev/Noetica" -type d -path '*/node_modules/@socioprophet/hellgraph/ts/dist' 2>/dev/null); do
    rsync -a "$HOME/dev/hellgraph/ts/dist/" "$d/" && echo "  synced hellgraph dist → $d"
  done
fi

echo "# ready. Resume the grind:  cd ~/dev/Noetica/agent-machine && bash scripts/ocw-grind.sh"
echo "# With 24GB you can also run vectorize + the 7B benchmark concurrently."
