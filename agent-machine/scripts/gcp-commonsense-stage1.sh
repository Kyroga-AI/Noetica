#!/bin/bash
# gcp-commonsense-stage1 — Stage 1 of the commonsense-KG ablation (docs/experiments/commonsense-kg-ablation.md).
# The honest kill-gate: does retrieval over a commonsense brain (A1) beat the bare 7B (A0)?
#
# Builds a BOUNDED commonsense field (CSKG + English ConceptNet + DBpedia, capped — this is a signal probe,
# not the full 3-week vectorize), SAVES it early (can't be lost), fetches the 4-choice retrieval benches
# (OpenBookQA + ARC), and runs baseline vs brain on them. If A1 doesn't beat A0 on a RETRIEVAL-designed
# bench, commonsense is an everyday-lane fallback only and we stop before spending Stage 2/3.
#
# PREREQ: sync-code-to-gcs.sh, $GCS/brain-complete.tar.gz, $GCS/mmlu_stem.json
# Usage:  GCP_PROJECT=socioprophet-platform bash scripts/gcp-commonsense-stage1.sh
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"; ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-cs-stage1}"; MACHINE="${MACHINE:-g2-standard-8}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
SAVED="${SAVED:-$GCS/brain-commonsense.tar.gz}"
CS_LIMIT="${CS_LIMIT:-40000}"; CS_SOURCES="${CS_SOURCES:-cskg,conceptnet,dbpedia}"; CS_LANG="${CS_LANG:-en}"
PER="${PER:-50}"; MODEL="${MODEL:-qwen2.5:7b}"; CONC="${CONC:-16}"
SUBJECTS="${SUBJECTS:-openbookqa,arc_challenge,arc_easy}"
LOG="$GCS/cs-stage1-run.log"
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=4)).replace(microsecond=0).isoformat())")}"

cat > /tmp/cs-stage1-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/cs-run.log 2>&1; set -x
export HOME=/root; GCS="$GCS"; SAVED="$SAVED"
( while true; do gsutil -q cp /var/log/cs-run.log "$LOG" 2>/dev/null; sleep 30; done ) & LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/cs-run.log "$LOG" 2>/dev/null||true; }

step "driver + ollama(GPU) + nomic"
for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done; nvidia-smi||echo "WARN no GPU"
for t in 1 2 3; do timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || true; command -v ollama && break; step "ollama install retry \$t"; sleep 6; done
command -v ollama || { step "FATAL ollama not on PATH after 3 tries"; exit 1; }
systemctl stop ollama 2>/dev/null||true; OLLAMA_NUM_PARALLEL=16 OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12
for n in 1 2 3 4 5; do timeout 1200 ollama pull $MODEL && break; sleep 8; done
ollama list | grep -q "$MODEL" || { step "FATAL model"; exit 1; }
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done

step "node + python + datasets"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step "FATAL node/py"; exit 1; }
PY=\$(which python3); \$PY -m pip install -q datasets pyarrow || \$PY -m pip install --break-system-packages -q datasets pyarrow

step "pull code + brain + bank"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && timeout 600 npm ci || { step "FATAL code"; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /opt/OCW || { step "FATAL brain"; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json || true
export OCW_BRAIN=/opt/OCW/_brain OLLAMA_HOST=http://127.0.0.1:11434

step "BUILD commonsense field — sources=$CS_SOURCES lang=$CS_LANG cap=$CS_LIMIT/source (bounded probe)"
CS_SOURCES="$CS_SOURCES" CS_LANG="$CS_LANG" CS_LIMIT=$CS_LIMIT \$PY scripts/fetch_commonsense_corpus.py || step "!! cs fetch \$?"
BRAIN_CONCURRENCY=$CONC \$PY scripts/vectorize_field.py commonsense || step "!! cs vectorize \$?"
step "SAVE commonsense brain → \$SAVED (before the board, so it can't be lost)"
tar -czf /tmp/csb.tgz -C /opt/OCW/_brain . && gsutil -q cp /tmp/csb.tgz "\$SAVED" && step "saved ✓"

step "fetch Stage-1 benches (OpenBookQA + ARC) into the bank"
\$PY scripts/fetch_commonsense_bench.py || step "!! bench fetch \$?"

step "A0 (baseline) vs A1 (brain) — $MODEL · $SUBJECTS · n=$PER · seed=1729"
OLLAMA_HOST=http://127.0.0.1:11434 OCW_BRAIN=/opt/OCW/_brain \
  MMLU_MODEL=$MODEL MMLU_ARMS=baseline,brain MMLU_PER_SUBJECT=$PER MMLU_SEED=1729 MMLU_SUBJECTS=$SUBJECTS \
  MMLU_MAX_CHUNKS=200000 MMLU_CONC=8 \
  bash scripts/run-exam.sh 2>&1 | tee /var/log/cs-board.txt || echo "EVAL EXIT \$?"
gsutil cp /var/log/cs-board.txt "\$GCS/bench/board-commonsense-stage1.txt" || true

step "DONE — A0-vs-A1 board at \$GCS/bench/board-commonsense-stage1.txt; brain at \$SAVED. Self-deleting."
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/cs-run.log "$LOG"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE L4) — commonsense Stage-1 ablation, HARD SHUTDOWN $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --maintenance-policy=TERMINATE \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --metadata="install-nvidia-driver=True" --metadata-from-file startup-script=/tmp/cs-stage1-startup.sh \
  --boot-disk-size=160GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE
echo "# launched. watch:  gsutil cat $GCS/cs-stage1-run.log   ·   result → $GCS/bench/board-commonsense-stage1.txt"
