#!/usr/bin/env bash
# build-domains-overnight — fetch + vectorize the medicine and legal brain fields LOCALLY, overnight.
#
# Each field: step 1 fetch (stream the corpus → text chunks), step 2 vectorize (nomic-768 via Ollama,
# in place). Resumable — vectorize_field.py skips chunks that already carry a vector, so a re-run
# continues where it stopped. NOT -e: a hiccup in one step must not abort the rest. Logs to the file below.
set -uo pipefail

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
export OCW_BRAIN="${OCW_BRAIN:-$HOME/Downloads/MIT OCW/_brain}"
export LEGAL_LIMIT="${LEGAL_LIMIT:-80000}"   # cap per legal source so the night completes (Pile of Law is huge)
cd "$(dirname "$0")/.."                        # agent-machine

step(){ echo; echo "==== $(date '+%F %T') $* ===="; }

step "MEDICINE 1/2 — fetch (MedRAG textbooks + statpearls)"
python3 scripts/fetch_medical_corpus.py all   || echo "!! medicine fetch returned $?"
step "MEDICINE 2/2 — vectorize (nomic-768 via Ollama, resumable)"
python3 scripts/vectorize_field.py medicine   || echo "!! medicine vectorize returned $?"

step "LEGAL 1/2 — fetch (Pile of Law: USC, CFR, caselaw, r/legaladvice; capped $LEGAL_LIMIT/source)"
python3 scripts/fetch_legal_corpus.py all      || echo "!! legal fetch returned $?"
step "LEGAL 2/2 — vectorize (resumable)"
python3 scripts/vectorize_field.py legal       || echo "!! legal vectorize returned $?"

step "DONE — domain status:"
npx tsx -e "import('./lib/knowledge-domains.js').then(m=>{for(const d of m.domainStatus().domains)console.log('  '+d.field.padEnd(16), d.status, 'courses='+d.courses)})" 2>/dev/null || true
echo "==== $(date '+%F %T') overnight build finished ===="
