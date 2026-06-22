#!/bin/bash
# gcp-gpu-eval — run the CHAMPION pipeline on a CAPABLE model, FAST, on a GPU box.
#
# The whole-session compute wall was CPU inference. An L4 runs a 7B 20-50x faster, so the full
# n=30 baseline/brain/champion eval finishes in minutes. Autonomous startup-script (no SSH):
# installs the NVIDIA driver + ollama (GPU) + the capable model, pulls code + brain + bank from
# GCS, runs the champion bench, pushes the scoreboard, self-deletes. HARD SHUTDOWN guard.
#
# Lessons baked in: HOME=/root (or ollama pull panics), robust model pull + abort-if-missing
# (don't run to a 0 result), log streamed to GCS every 30s.
#
# PREREQ: $GCS/brain-complete.tar.gz, $GCS/code/agent-machine/, $GCS/mmlu_stem.json
# Usage:  GCP_PROJECT=socioprophet-platform bash scripts/gcp-gpu-eval.sh
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-champ-eval}"
MACHINE="${MACHINE:-g2-standard-8}"          # 1x NVIDIA L4 (24GB) — fits 7B and 14B
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
MODEL="${MODEL:-qwen2.5:7b}"
ARMS="${ARMS:-baseline,brain}"           # the core run; champion(verify) is too slow over big fields on CPU
PER="${PER:-30}"
MAXCHUNKS="${MAXCHUNKS:-30000}"          # per-field pool cap — keeps JS cosine fast (math is 150k otherwise)
SUBJECTS="${SUBJECTS:-high_school_biology,conceptual_physics,electrical_engineering,college_chemistry,high_school_statistics,college_mathematics,abstract_algebra}"
RUN_TAG="${RUN_TAG:-}"                                   # suffix to isolate parallel runs (log + VM)
LOG="$GCS/eval-run${RUN_TAG:+-$RUN_TAG}.log"             # per-run GCS log path so two evals don't clobber each other
# Backstop hard-delete. The startup self-delete (gcloud instances delete) FAILS when the VM SA
# (sourceos-ci) lacks compute.instances.delete → the VM zombies until this guard fires. Capped at
# +2h (a full T4 board finishes in <75min) so a self-delete failure wastes ≤2h, not 4h. REAL FIX:
# grant the SA roles/compute.instanceAdmin.v1 so the on-done self-delete works promptly.
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=2)).replace(microsecond=0).isoformat())")}"

cat > /tmp/gpu-eval-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/eval-run.log 2>&1; set -x
export HOME=/root
GCS="$GCS"
( while true; do gsutil -q cp /var/log/eval-run.log "$LOG" 2>/dev/null; sleep 30; done ) & LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/eval-run.log "$LOG" 2>/dev/null||true; }

step "wait for NVIDIA driver"
for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
nvidia-smi || echo "WARN: no GPU visible (will run slow)"

step "install ollama (GPU)"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step "FATAL ollama install"; exit 1; }
systemctl stop ollama 2>/dev/null || true
OLLAMA_NUM_PARALLEL=8 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 &
sleep 12

step "pull model $MODEL (each pull timeout-bounded — a STALLED download can't hang forever)"
for n in 1 2 3 4 5; do timeout 1200 ollama pull $MODEL && break; step "model pull retry \$n (timed out/failed)"; sleep 8; done
ollama list | grep -q "$MODEL" || { step "FATAL: model $MODEL missing after retries"; exit 1; }
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; step "embed retry \$n"; sleep 8; done
ollama list | grep -q nomic-embed-text || { step "FATAL: embed model missing"; exit 1; }

step "install node + python"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step "FATAL: node/python install"; exit 1; }
PY=\$(which python3)
\$PY -m pip install -q sympy numpy scikit-learn || \$PY -m pip install --break-system-packages -q sympy numpy scikit-learn
\$PY -c "import sympy,numpy,sklearn" || { step "FATAL: python deps not importable by \$PY"; exit 1; }

step "pull code + npm ci"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ || { step "FATAL: code pull"; exit 1; }
cd /opt/am && timeout 600 npm ci || { step "FATAL: npm ci hung/failed"; exit 1; }

step "pull brain (1.5GB) + bank"
mkdir -p /opt/OCW && timeout 900 gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz || { step "FATAL: brain pull"; exit 1; }
tar xzf /tmp/b.tgz -C /opt/OCW || { step "FATAL: brain extract"; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json
step "SETUP COMPLETE ✓ — starting eval"

step "run CHAMPION eval — $MODEL · arms=$ARMS · n=$PER · seed=1729"
OLLAMA_HOST=http://127.0.0.1:11434 OCW_BRAIN=/opt/OCW/_brain \
  MMLU_MODEL=$MODEL MMLU_ARMS=$ARMS MMLU_PER_SUBJECT=$PER MMLU_SEED=1729 MMLU_SUBJECTS=$SUBJECTS MMLU_MAX_CHUNKS=$MAXCHUNKS MMLU_CONC=${CONC:-8} MMLU_CISC=${CISC:-1} MMLU_HYBRID=${HYBRID:-1} MMLU_NO_THINK=${NO_THINK:-0} MMLU_MANIP=${MANIP:-1} MMLU_COUNCIL_V2=${COUNCIL_V2:-1} \
  bash scripts/run-exam.sh 2>&1 | tee /var/log/scoreboard.txt || echo "EVAL EXITED \$?"
gsutil cp /var/log/scoreboard.txt "\$GCS/bench/champion-$MODEL.txt" || true
# keep the rich per-question transcript (sources, ktype, sc_agree, qgen) for the miss-deepdive —
# it's written under HOME and would otherwise vanish on self-delete.
LATEST_T=\$(ls -t /root/.noetica/mmlu-brain-*.jsonl 2>/dev/null | head -1)
[ -n "\$LATEST_T" ] && gsutil cp "\$LATEST_T" "\$GCS/bench/transcript-$MODEL.jsonl" || true

step "DONE — self-deleting"
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/eval-run.log "$LOG"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

ACCELFLAG=""; [ -n "${ACCEL:-}" ] && ACCELFLAG="--accelerator=type=$ACCEL,count=1"   # T4 fallback when L4 is stocked out (qwen2.5:7b fits a 16GB T4)
echo "# creating $VM ($MACHINE ${ACCEL:-L4} GPU) — champion eval on $MODEL, HARD SHUTDOWN at $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --maintenance-policy=TERMINATE $ACCELFLAG \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --metadata="install-nvidia-driver=True" --metadata-from-file startup-script=/tmp/gpu-eval-startup.sh \
  --boot-disk-size=120GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE

echo "# launched. watch:  gsutil cat $GCS/eval-run.log   ·   scoreboard → $GCS/bench/champion-$MODEL.txt"
