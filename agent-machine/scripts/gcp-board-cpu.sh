#!/bin/bash
# gcp-board-cpu — the BULLETPROOF board. CPU on GCP (no GPU = no embed-vs-generation contention, the flake
# that killed every GPU board) + per-question checkpoint to GCS + AUTO-RESUME LOOP ON THE VM: it re-runs the
# board, resuming from the checkpoint, on every stall/crash, and only self-deletes when done==total. If the
# whole VM dies, relaunch (same RUN_TAG) resumes from the GCS checkpoint. No human babysitting, ever.
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
BRAIN_TGZ="${BRAIN_TGZ:-$GCS/brain-complete.tar.gz}"
RUN_TAG="${RUN_TAG:-cpu}"
VM="board-$RUN_TAG"
MODEL="${BOARD_MODEL:-qwen2.5:7b}"
ARMS="${BOARD_ARMS:-baseline,brain,notecard,gate,compute}"
PER="${PER:-15}"
SUBJECTS="${SUBJECTS:-college_mathematics,college_physics,college_chemistry,college_biology,abstract_algebra,high_school_statistics}"
STALL_MIN="${STALL_MIN:-15}"
MACHINE="${MACHINE:-c2d-standard-16}"
ZONES="${ZONES:-us-east1-b us-east1-c us-east1-d us-central1-a us-central1-b us-central1-c us-west1-a us-west1-b us-east4-a us-east4-c}"
# BAKED IMAGE: set BOARD_IMAGE_NAME=board-base (built by build-board-image.sh) to boot from a custom image with
# node/python/ollama+models pre-installed — the startup's install steps become instant no-ops (~3min vs ~10min).
IMAGE_NAME="${BOARD_IMAGE_NAME:-}"
if [ -n "$IMAGE_NAME" ]; then IMG_ARGS="--image=$IMAGE_NAME"; else IMG_ARGS="--image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud"; fi
CKPT="$GCS/bench/ckpt-$RUN_TAG.jsonl"; STATUS="$GCS/bench/status-$RUN_TAG.json"
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=10)).replace(microsecond=0).isoformat())")

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(name)" 2>/dev/null)
[ -n "$ex" ] && { echo "ABORT — $VM already running (it auto-resumes itself; nothing to do)"; exit 0; }
echo "# board-$RUN_TAG · CPU $MACHINE · arms=$ARMS · $PER/subj · auto-resume → done==total"

cat > /tmp/cpu-board-startup.sh <<STARTUP
#!/bin/bash
export HOME=/root; mkdir -p /root/.noetica
LCKPT=/root/.noetica/ckpt.jsonl; LSTATUS=/root/.noetica/status.json
exec >/var/log/board.log 2>&1; set -x
GCS="$GCS"
( while true; do
    gsutil -q cp /var/log/board.log "\$GCS/bench/board-$RUN_TAG.log" 2>/dev/null
    [ -s "\$LCKPT" ]   && gsutil -q cp "\$LCKPT"   "$CKPT"   2>/dev/null
    [ -s "\$LSTATUS" ] && gsutil -q cp "\$LSTATUS" "$STATUS" 2>/dev/null
    sleep 15
  done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }
step "ollama + models (CPU, no GPU contention)"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step FATAL-ollama; exit 1; }
systemctl stop ollama 2>/dev/null||true
OLLAMA_NUM_PARALLEL=2 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=60m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done
for n in 1 2 3 4 5; do timeout 1800 ollama pull $MODEL && break; sleep 8; done
step "node + python"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step FATAL-node; exit 1; }
python3 -m pip install -q sympy numpy scikit-learn 2>/dev/null || python3 -m pip install --break-system-packages -q sympy numpy scikit-learn || true
step "pull code + brain"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && timeout 600 npm ci || { step FATAL-code; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "$BRAIN_TGZ" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /opt/OCW || { step FATAL-brain; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json || true
gsutil -q cp "$CKPT" "\$LCKPT" 2>/dev/null && step "RESUMED from GCS checkpoint (\$(wc -l < \$LCKPT 2>/dev/null||echo 0) q already done)" || step "fresh run"
BRAINDIR=/opt/OCW/_brain; [ -d "\$BRAINDIR" ] || BRAINDIR=/opt/OCW
export OCW_BRAIN=\$BRAINDIR OLLAMA_HOST=http://127.0.0.1:11434

# ── AUTO-RESUME LOOP: run → on stall/crash resume from checkpoint → repeat until done==total ───────────────
ATTEMPT=0
while true; do
  ATTEMPT=\$((ATTEMPT+1)); rm -f /tmp/stalled; step "board attempt \$ATTEMPT (arms=$ARMS)"
  ( prev=-1; stuck=0; while true; do sleep 60
      cur=\$(python3 -c "import json;print(json.load(open('\$LSTATUS'))['done'])" 2>/dev/null||echo -1)
      if [ "\$cur" = "\$prev" ]; then stuck=\$((stuck+1)); else stuck=0; prev=\$cur; fi
      [ "\$stuck" -ge $STALL_MIN ] && { step "STALL — done=\$cur frozen ${STALL_MIN}min; killing → will resume"; pkill -f mmlu-brain-bench; touch /tmp/stalled; break; }
    done ) & WD=\$!
  MMLU_MODEL=$MODEL MMLU_ARMS="$ARMS" MMLU_PER_SUBJECT=$PER MMLU_SEED=1729 MMLU_SUBJECTS=$SUBJECTS \
    MMLU_CONC=2 MMLU_ASK_RETRIES=3 NOETICA_EMBED_TIMEOUT_MS=120000 \
    MMLU_CHECKPOINT=\$LCKPT MMLU_STATUS=\$LSTATUS \
    stdbuf -oL -eL bash scripts/run-exam.sh > /var/log/sb.txt 2>&1
  EXIT=\$?; kill \$WD 2>/dev/null
  gsutil -q cp "\$LCKPT" "$CKPT" 2>/dev/null; gsutil -q cp /var/log/sb.txt "\$GCS/bench/board-$RUN_TAG-result.txt" 2>/dev/null
  DONE=\$(python3 -c "import json;d=json.load(open('\$LSTATUS'));print(1 if d.get('done',0)>=d.get('total',1) else 0)" 2>/dev/null||echo 0)
  if [ ! -f /tmp/stalled ] && [ "\$EXIT" = "0" ] && [ "\$DONE" = "1" ]; then step "COMPLETE — done==total ✓"; break; fi
  [ "\$ATTEMPT" -ge 25 ] && { step "gave up after 25 attempts (something is wrong)"; break; }
  step "incomplete (stall=\$([ -f /tmp/stalled ] && echo yes||echo no) exit=\$EXIT done=\$DONE) — resuming in 10s"; sleep 10
done

T=\$(ls -t /root/.noetica/mmlu-brain-*.jsonl 2>/dev/null|head -1); [ -n "\$T" ] && gsutil -q cp "\$T" "\$GCS/bench/transcript-$RUN_TAG.jsonl" || true
step "self-delete"
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

for Z in $ZONES; do
  echo "  trying $VM ($MACHINE) in $Z"
  if gcloud compute instances create $VM --project=$PROJECT --zone=$Z --machine-type=$MACHINE \
      $IMG_ARGS \
      --metadata-from-file startup-script=/tmp/cpu-board-startup.sh \
      --boot-disk-size=120GB --service-account=$SA --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE >/dev/null 2>&1; then
    echo "=== board-$RUN_TAG LAUNCHED in $Z — countdown: gcloud storage cat $STATUS ==="; exit 0
  fi
  echo "    $Z failed (stockout?), next"
done
echo "FATAL — all zones failed"; exit 1
