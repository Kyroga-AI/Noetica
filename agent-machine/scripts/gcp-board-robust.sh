#!/bin/bash
# gcp-board-robust — the resilient board runner. The fix for "we keep losing batches". Properties:
#   • RESUMABLE   — pulls a GCS checkpoint on start; the board (MMLU_CHECKPOINT) skips already-done questions.
#                   A flake/crawl/kill costs ≤1 question; relaunch the SAME RUN_TAG and it continues.
#   • LIVE        — the board writes status-<tag>.json per batch; a sidecar syncs it (+ the checkpoint + the
#                   streamed log) to GCS every 15s. No more blind waiting — poll status-<tag>.json.
#   • STALL-GUARDED — a watchdog aborts if `done` doesn't advance in STALL_MIN; the checkpoint is preserved,
#                   so relaunching resumes. No more silent 90-min crawls.
#   • STREAMING   — stdbuf line-buffers the board so progress hits GCS immediately (no tail/tee buffering).
# The old one-off launchers are untouched and unused; this is the path we run going forward.
#
# Usage: BRAIN_TGZ=gs://.../brains/brain-v4.tar.gz RUN_TAG=v4 BOARD_ARMS="baseline,brain,...,learned" \
#          bash scripts/gcp-board-robust.sh        # re-run same RUN_TAG to RESUME
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
BRAIN_TGZ="${BRAIN_TGZ:-$GCS/brain-complete.tar.gz}"
RUN_TAG="${RUN_TAG:-board}"
VM="board-$RUN_TAG"
MODEL="${BOARD_MODEL:-qwen2.5:7b}"
ARMS="${BOARD_ARMS:-baseline,brain,gate,champion,learned}"
PER="${PER:-100}"
SUBJECTS="${SUBJECTS:-high_school_biology,conceptual_physics,electrical_engineering,college_chemistry,high_school_statistics,college_mathematics,abstract_algebra}"
STALL_MIN="${STALL_MIN:-10}"
CONC="${CONC:-6}"   # questions scored per batch; LOWER for SC-heavy arm sets (reason/prod/opcompute) so 'done' advances before the stall-guard trips on a big first batch
ZONES="${ZONES:-us-east1-d us-east4-a us-east4-c us-west1-a us-west1-b us-west4-a us-central1-a us-central1-b us-central1-c}"
CKPT="$GCS/bench/ckpt-$RUN_TAG.jsonl"
STATUS="$GCS/bench/status-$RUN_TAG.json"
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=6)).replace(microsecond=0).isoformat())")

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(name)" 2>/dev/null)
[ -n "$ex" ] && { echo "ABORT — $VM already exists (a run is in flight)"; exit 0; }
echo "# board-$RUN_TAG · brain=$BRAIN_TGZ · arms=$ARMS · resume-from=$CKPT"

cat > /tmp/robust-startup.sh <<STARTUP
#!/bin/bash
export HOME=/root; mkdir -p /root/.noetica
LCKPT=/root/.noetica/ckpt.jsonl; LSTATUS=/root/.noetica/status.json
exec >/var/log/board.log 2>&1; set -x
GCS="$GCS"
# sidecar: stream log + sync checkpoint + status to GCS every 15s (durable + live)
( while true; do
    gsutil -q cp /var/log/board.log "\$GCS/bench/board-$RUN_TAG.log" 2>/dev/null
    [ -s "\$LCKPT" ]   && gsutil -q cp "\$LCKPT"   "$CKPT"   2>/dev/null
    [ -s "\$LSTATUS" ] && gsutil -q cp "\$LSTATUS" "$STATUS" 2>/dev/null
    sleep 15
  done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }

step "wait GPU"; for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
step "ollama + models"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step FATAL-ollama; exit 1; }
systemctl stop ollama 2>/dev/null||true
OLLAMA_NUM_PARALLEL=8 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done
for n in 1 2 3 4 5; do timeout 1800 ollama pull $MODEL && break; sleep 8; done
# PREWARM the embed model — first embed cold-loads the model, which alone can exceed the 8s default
# timeout under generation contention; warming it here means the board's first retrieval doesn't pay it.
step "prewarm nomic-embed"
for n in 1 2 3; do curl -fsS --max-time 120 http://127.0.0.1:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"warm"}' >/dev/null 2>&1 && break; sleep 5; done
step "node + python"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step FATAL-node; exit 1; }
python3 -m pip install -q sympy numpy scikit-learn || python3 -m pip install --break-system-packages -q sympy numpy scikit-learn
step "pull code + brain"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && timeout 600 npm ci || { step FATAL-code; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "$BRAIN_TGZ" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /opt/OCW || { step FATAL-brain; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json || true
# RESUME: pull the checkpoint so the board skips already-done questions
gsutil -q cp "$CKPT" "\$LCKPT" 2>/dev/null && step "RESUMED (\$(wc -l < \$LCKPT 2>/dev/null||echo 0) questions in checkpoint)" || step "fresh run"
# brain tars differ: some include the _brain/ dir, some are contents-only (v4 SAVE_BRAIN used -C _brain .).
# Point OCW_BRAIN at wherever the field subdirs actually landed.
BRAINDIR=/opt/OCW/_brain; [ -d "\$BRAINDIR" ] || BRAINDIR=/opt/OCW
step "brain dir = \$BRAINDIR (\$(ls "\$BRAINDIR" 2>/dev/null | tr '\n' ' '))"
export OCW_BRAIN=\$BRAINDIR OLLAMA_HOST=http://127.0.0.1:11434

# ground_kgbert arm: the decorrelated KG-BERT retriever needs torch + the encoded entity vectors. Install/pull
# ONLY when that arm is requested, so ordinary boards stay lean (no 2GB torch on every run). EXPORT the env
# directly (a variable-expanded 'VAR=x' command prefix is NOT treated as an assignment by bash → exit 127).
if echo "$ARMS" | grep -q ground_kgbert; then
  step "ground_kgbert — torch + KG-BERT embeddings (.npz)"
  mkdir -p /root/.noetica/kg
  python3 -m pip install -q torch --index-url https://download.pytorch.org/whl/cu124 || python3 -m pip install -q torch
  python3 -m pip install -q transformers
  gsutil -q cp "\$GCS/kg-bert/kg-bert-embeddings.npz" /root/.noetica/kg/kg-bert-embeddings.npz
  gsutil -q cp "\$GCS/kg-export/entities.jsonl"        /root/.noetica/kg/entities.jsonl
  export MMLU_KGBERT_NPZ=/root/.noetica/kg/kg-bert-embeddings.npz MMLU_KGBERT_DEVICE=cuda
fi

# stall watchdog: 'done' frozen for STALL_MIN min → abort (checkpoint preserved → relaunch resumes)
( prev=-1; stuck=0; while true; do sleep 60
    cur=\$(python3 -c "import json;print(json.load(open('\$LSTATUS'))['done'])" 2>/dev/null||echo -1)
    if [ "\$cur" = "\$prev" ]; then stuck=\$((stuck+1)); else stuck=0; prev=\$cur; fi
    [ "\$stuck" -ge $STALL_MIN ] && { step "STALL — done=\$cur frozen ${STALL_MIN}min; aborting (checkpoint safe)"; pkill -f mmlu-brain-bench; touch /tmp/stalled; break; }
  done ) &

step "BOARD $RUN_TAG — arms=$ARMS · resumable · streaming · stall-guarded"
MMLU_MODEL=$MODEL MMLU_ARMS="$ARMS" MMLU_PER_SUBJECT=$PER MMLU_SEED=1729 MMLU_SUBJECTS=$SUBJECTS \
  MMLU_CHECKPOINT=\$LCKPT MMLU_STATUS=\$LSTATUS \
  NOETICA_EMBED_TIMEOUT_MS=\${NOETICA_EMBED_TIMEOUT_MS:-60000} NOETICA_EMBED_RETRIES=\${NOETICA_EMBED_RETRIES:-3} \
  MMLU_CONC=$CONC \
  stdbuf -oL -eL bash scripts/run-exam.sh > /var/log/sb.txt 2>&1
EXIT=\$?
gsutil -q cp "\$LCKPT" "$CKPT" 2>/dev/null
gsutil cp /var/log/sb.txt "\$GCS/bench/board-$MODEL-$RUN_TAG.txt" 2>/dev/null || true
T=\$(ls -t /root/.noetica/mmlu-brain-*.jsonl 2>/dev/null|head -1); [ -n "\$T" ] && gsutil -q cp "\$T" "\$GCS/bench/transcript-$RUN_TAG.jsonl" || true
[ -f /tmp/stalled ] && step "ENDED stalled — relaunch same RUN_TAG to resume" || step "DONE (exit \$EXIT)"
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

for Z in $ZONES; do
  echo "  trying $VM in $Z"
  if gcloud compute instances create $VM --project=$PROJECT --zone=$Z --machine-type=g2-standard-8 \
      --maintenance-policy=TERMINATE --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
      --metadata=install-nvidia-driver=True --metadata-from-file startup-script=/tmp/robust-startup.sh \
      --boot-disk-size=200GB --service-account=$SA --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE >/dev/null 2>&1; then
    echo "=== board-$RUN_TAG LAUNCHED in $Z — poll: gcloud storage cat $STATUS ==="
    exit 0
  fi
  echo "    $Z failed (stockout?), next"
done
echo "FATAL — all zones failed"; exit 1
