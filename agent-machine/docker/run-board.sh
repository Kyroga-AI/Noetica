#!/bin/bash
# run-board — entrypoint for the baked board-base container. The slow installs (ollama+models, node, python,
# gcloud) are already in the image; this pulls only the fast-changing bits (code, brain, checkpoint) and runs
# the same bulletproof auto-resume loop as gcp-board-cpu.sh. Env (with defaults): GCS RUN_TAG BOARD_MODEL
# BOARD_ARMS PER SUBJECTS STALL_MIN BRAIN_TGZ.
export HOME=/root; mkdir -p /root/.noetica
GCS="${GCS:-gs://sourceos-artifacts-socioprophet/ocw-corpus}"
RUN_TAG="${RUN_TAG:-cpu}"; MODEL="${BOARD_MODEL:-qwen2.5:7b}"
ARMS="${BOARD_ARMS:-baseline,brain,notecard,gate,compute}"; PER="${PER:-15}"
SUBJECTS="${SUBJECTS:-college_mathematics,college_physics,college_chemistry,college_biology,abstract_algebra,high_school_statistics}"
STALL_MIN="${STALL_MIN:-15}"; BRAIN_TGZ="${BRAIN_TGZ:-$GCS/brain-complete.tar.gz}"
CKPT="$GCS/bench/ckpt-$RUN_TAG.jsonl"; STATUS="$GCS/bench/status-$RUN_TAG.json"
LCKPT=/root/.noetica/ckpt.jsonl; LSTATUS=/root/.noetica/status.json
exec >/var/log/board.log 2>&1; set -x
step(){ echo "==== $(date '+%H:%M:%S') $* ===="; }

# background GCS sync of log / checkpoint / status (the watchdog watches $STATUS)
( while true; do
    gsutil -q cp /var/log/board.log "$GCS/bench/board-$RUN_TAG.log" 2>/dev/null
    [ -s "$LCKPT" ]   && gsutil -q cp "$LCKPT"   "$CKPT"   2>/dev/null
    [ -s "$LSTATUS" ] && gsutil -q cp "$LSTATUS" "$STATUS" 2>/dev/null
    sleep 15
  done ) &

step "ollama serve (models already baked into the image)"
OLLAMA_NUM_PARALLEL=2 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=60m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 8
ollama list || step "WARN ollama not responding"

step "pull code + brain (the only slow runtime bits)"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && timeout 600 npm ci || { step FATAL-code; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "$BRAIN_TGZ" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /opt/OCW || { step FATAL-brain; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json || true
gsutil -q cp "$CKPT" "$LCKPT" 2>/dev/null && step "RESUMED ($(wc -l < $LCKPT 2>/dev/null||echo 0) q already done)" || step "fresh run"
BRAINDIR=/opt/OCW/_brain; [ -d "$BRAINDIR" ] || BRAINDIR=/opt/OCW
export OCW_BRAIN=$BRAINDIR OLLAMA_HOST=http://127.0.0.1:11434

# ── AUTO-RESUME LOOP: run → on stall/crash resume from checkpoint → repeat until done==total ───────────────
ATTEMPT=0
while true; do
  ATTEMPT=$((ATTEMPT+1)); rm -f /tmp/stalled; step "board attempt $ATTEMPT (arms=$ARMS)"
  ( prev=-1; stuck=0; while true; do sleep 60
      cur=$(python3 -c "import json;print(json.load(open('$LSTATUS'))['done'])" 2>/dev/null||echo -1)
      if [ "$cur" = "$prev" ]; then stuck=$((stuck+1)); else stuck=0; prev=$cur; fi
      [ "$stuck" -ge "$STALL_MIN" ] && { step "STALL — done=$cur frozen ${STALL_MIN}min; killing → will resume"; pkill -f mmlu-brain-bench; touch /tmp/stalled; break; }
    done ) & WD=$!
  MMLU_MODEL=$MODEL MMLU_ARMS="$ARMS" MMLU_PER_SUBJECT=$PER MMLU_SEED=1729 MMLU_SUBJECTS=$SUBJECTS \
    MMLU_CONC=2 MMLU_ASK_RETRIES=3 NOETICA_EMBED_TIMEOUT_MS=120000 \
    MMLU_CHECKPOINT=$LCKPT MMLU_STATUS=$LSTATUS \
    stdbuf -oL -eL bash scripts/run-exam.sh > /var/log/sb.txt 2>&1
  EXIT=$?; kill "$WD" 2>/dev/null
  gsutil -q cp "$LCKPT" "$CKPT" 2>/dev/null; gsutil -q cp /var/log/sb.txt "$GCS/bench/board-$RUN_TAG-result.txt" 2>/dev/null
  DONE=$(python3 -c "import json;d=json.load(open('$LSTATUS'));print(1 if d.get('done',0)>=d.get('total',1) else 0)" 2>/dev/null||echo 0)
  if [ ! -f /tmp/stalled ] && [ "$EXIT" = "0" ] && [ "$DONE" = "1" ]; then step "COMPLETE — done==total ✓"; break; fi
  [ "$ATTEMPT" -ge 25 ] && { step "gave up after 25 attempts (something is wrong)"; break; }
  step "incomplete (stall=$([ -f /tmp/stalled ] && echo yes||echo no) exit=$EXIT done=$DONE) — resuming in 10s"; sleep 10
done

T=$(ls -t /root/.noetica/mmlu-brain-*.jsonl 2>/dev/null|head -1); [ -n "$T" ] && gsutil -q cp "$T" "$GCS/bench/transcript-$RUN_TAG.jsonl" || true
step "self-delete VM"
N=$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print $NF}')
gcloud compute instances delete "$N" --zone="$Z" --quiet
