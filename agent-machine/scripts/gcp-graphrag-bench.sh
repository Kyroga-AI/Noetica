#!/bin/bash
# gcp-graphrag-bench — Job 2: measure the real dual-layer retriever against GraphRAG-Bench.
#
# What this does:
#   1. Spins a GCP L4 VM (g2-standard-8)
#   2. Installs ollama + nomic-embed-text + the board model
#   3. Pulls code from GCS bucket (same path as gcp-board-robust)
#   4. Pulls brain from BRAIN_TGZ
#   5. Downloads GraphRAG-Bench corpora to ~/.noetica/corpus/benchmarks/graphrag-bench/
#   6. Starts agent-machine server (:8080)
#   7. Runs graphrag-bench.py --use-server for both domains
#   8. Streams answers JSON + log to GCS; auto-terminates
#
# Usage:
#   RUN_TAG=grb-v1 bash scripts/gcp-graphrag-bench.sh          # defaults: n=200, model=qwen2.5:7b
#   RUN_TAG=grb-v1 GRB_N=50 bash scripts/gcp-graphrag-bench.sh # quick smoke (n=50)
#
# Read results from:
#   gs://sourceos-artifacts-socioprophet/ocw-corpus/bench/grb-<RUN_TAG>-medical.json
#   gs://sourceos-artifacts-socioprophet/ocw-corpus/bench/grb-<RUN_TAG>-novel.json
#   gs://sourceos-artifacts-socioprophet/ocw-corpus/bench/grb-<RUN_TAG>.log
# Score with GraphRAG-Bench's own evaluator:
#   python3 Evaluation/metrics/answer_accuracy.py grb-<RUN_TAG>-medical.json

set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
BRAIN_TGZ="${BRAIN_TGZ:-$GCS/brain-complete.tar.gz}"
RUN_TAG="${RUN_TAG:-grb-v1}"
VM="grb-$RUN_TAG"
MODEL="${GRB_MODEL:-qwen2.5:7b}"
N="${GRB_N:-200}"
GRB_BUCKET="${GRB_BUCKET:-$GCS/benchmarks/graphrag-bench}"
ZONES="${ZONES:-us-east1-d us-east4-a us-east4-c us-west1-a us-central1-a us-central1-b}"

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(name)" 2>/dev/null)
[ -n "$ex" ] && { echo "ABORT — $VM already exists (job in flight); re-run with a different RUN_TAG"; exit 1; }
echo "# graphrag-bench · run=$RUN_TAG · model=$MODEL · n=$N"

ZONE=""
for z in $ZONES; do
  echo -n "  trying $z ... "
  if gcloud compute instances create "$VM" \
    --project="$PROJECT" \
    --zone="$z" \
    --machine-type=g2-standard-8 \
    --accelerator=type=nvidia-l4,count=1 \
    --maintenance-policy=TERMINATE \
    --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
    --boot-disk-size=100GB \
    --scopes=cloud-platform \
    --metadata=startup-script="$(cat <<STARTUP
#!/bin/bash
export HOME=/root; mkdir -p /root/.noetica/corpus/benchmarks/graphrag-bench
exec >/var/log/grb.log 2>&1; set -x
GCS="$GCS"
RUN_TAG="$RUN_TAG"
MODEL="$MODEL"
N="$N"

# sidecar: stream log to GCS every 15s
( while true; do
    gsutil -q cp /var/log/grb.log "\$GCS/bench/grb-\$RUN_TAG.log" 2>/dev/null
    sleep 15
  done ) &

step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }

step "wait GPU"
for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done

step "ollama"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step FATAL-ollama; exit 1; }
systemctl stop ollama 2>/dev/null||true
OLLAMA_KEEP_ALIVE=60m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12

step "pull models"
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done
for n in 1 2 3 4 5; do timeout 1800 ollama pull \$MODEL && break; sleep 8; done

step "node + python deps"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' \
  && timeout 300 apt-get install -y nodejs git python3-pip \
  || { step FATAL-node; exit 1; }
python3 -m pip install -q sympy numpy scikit-learn 2>/dev/null \
  || python3 -m pip install --break-system-packages -q sympy numpy scikit-learn

step "pull code + brain"
mkdir -p /opt/am
timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ \
  && cd /opt/am && timeout 600 npm ci \
  || { step FATAL-code; exit 1; }
mkdir -p /opt/OCW
timeout 900 gsutil cp "$BRAIN_TGZ" /tmp/b.tgz \
  && tar xzf /tmp/b.tgz -C /opt/OCW \
  || { step FATAL-brain; exit 1; }
BRAINDIR=/opt/OCW/_brain; [ -d "\$BRAINDIR" ] || BRAINDIR=/opt/OCW
step "brain dir = \$BRAINDIR"

step "graphrag-bench corpora"
gsutil -q cp "$GRB_BUCKET/medical_corpus.json"   /root/.noetica/corpus/benchmarks/graphrag-bench/ \
  || { step FATAL-grb-medical-corpus; exit 1; }
gsutil -q cp "$GRB_BUCKET/medical_questions.json" /root/.noetica/corpus/benchmarks/graphrag-bench/ \
  || { step FATAL-grb-medical-qs; exit 1; }
gsutil -q cp "$GRB_BUCKET/novel_corpus.json"      /root/.noetica/corpus/benchmarks/graphrag-bench/ \
  || { step FATAL-grb-novel-corpus; exit 1; }
gsutil -q cp "$GRB_BUCKET/novel_questions.json"   /root/.noetica/corpus/benchmarks/graphrag-bench/ \
  || { step FATAL-grb-novel-qs; exit 1; }

step "start agent-machine server"
export OCW_BRAIN=\$BRAINDIR OLLAMA_HOST=http://127.0.0.1:11434
cd /opt/am
nohup node dist/server.js >/var/log/server.log 2>&1 &
SERVER_PID=\$!
# Wait up to 60s for the server to be ready
for i in \$(seq 1 60); do
  curl -sf http://127.0.0.1:8080/api/status >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://127.0.0.1:8080/api/status >/dev/null || { step FATAL-server-not-ready; exit 1; }
step "server ready (pid=\$SERVER_PID)"

step "graphrag-bench medical (n=\$N)"
python3 /opt/am/scripts/graphrag-bench.py \
  --domain medical --n \$N --use-server --api-base http://127.0.0.1:8080 \
  --out /tmp/grb-\$RUN_TAG-medical.json \
  && gsutil cp /tmp/grb-\$RUN_TAG-medical.json "\$GCS/bench/grb-\$RUN_TAG-medical.json" \
  && step "medical done" || step "medical FAILED (continuing)"

step "graphrag-bench novel (n=\$N)"
python3 /opt/am/scripts/graphrag-bench.py \
  --domain novel --n \$N --use-server --api-base http://127.0.0.1:8080 \
  --out /tmp/grb-\$RUN_TAG-novel.json \
  && gsutil cp /tmp/grb-\$RUN_TAG-novel.json "\$GCS/bench/grb-\$RUN_TAG-novel.json" \
  && step "novel done" || step "novel FAILED"

step "COMPLETE — answers at gs://sourceos-artifacts-socioprophet/ocw-corpus/bench/grb-\$RUN_TAG-*.json"
# Final log sync + self-terminate
gsutil -q cp /var/log/grb.log "\$GCS/bench/grb-\$RUN_TAG.log" 2>/dev/null
gcloud compute instances delete "\$VM" --zone="$z" --quiet 2>/dev/null &
STARTUP
)" \
    --quiet 2>/dev/null; then
    ZONE="$z"
    echo "launched in $z"
    break
  fi
  echo "no capacity"
done

[ -z "$ZONE" ] && { echo "ERROR: no zone had L4 capacity; try later or change ZONES="; exit 1; }
echo ""
echo "Job running on $VM ($ZONE). Monitor:"
echo "  watch: gcloud storage cat $GCS/bench/grb-$RUN_TAG.log 2>/dev/null | tail -30"
echo "  status: gcloud compute instances list --project=$PROJECT --filter=name=$VM"
echo "Results when done:"
echo "  $GCS/bench/grb-$RUN_TAG-medical.json"
echo "  $GCS/bench/grb-$RUN_TAG-novel.json"
