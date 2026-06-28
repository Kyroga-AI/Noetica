#!/bin/bash
# gcp-finish-corpus — ONE GPU job to FINISH the MIT corpus, and optionally distill + run a stronger board.
#
# We captured 979 OCW courses (23GB on disk) but only vectorized 368 (the 7 MMLU-STEM departments). This
# vectorizes the REST on the L4 (fast), so the brain stops being "a STEM slice mostly of lecture prose".
# Steps (each gated): BUILD-CORPUS (all captured depts) → re-publish the brain → (DISTILL) SFT data from the
# gold → (BOARD_MODEL) run the gold-first board on a stronger model.
#
# PREREQ this script handles: the captured _corpus must reach GCS. Step 0 syncs it (gcloud storage; first
# time ~23GB, then incremental). Also needs $GCS/brain-complete.tar.gz, $GCS/mmlu_stem.json, and
# $GCS/code/agent-machine (run scripts/sync-code-to-gcs.sh first for the gold-first code).
#
# Usage (one command in the morning):
#   GCP_PROJECT=socioprophet-platform bash scripts/gcp-finish-corpus.sh
#   # options:  DEPTS="14,1,2,15"  (default ALL captured)   DISTILL=1   BOARD_MODEL=qwen2.5:14b
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-finish-corpus}"
MACHINE="${MACHINE:-g2-standard-8}"          # L4 (24GB) — fits nomic + a 14B board model
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
DEPTS="${DEPTS:-}"                            # "" = ALL captured departments (finish the corpus); or a comma list of OCW dept codes
DISTILL="${DISTILL:-0}"                       # 1 = run distill_prep on the gold fields → SFT JSONL → GCS
DISTILL_FIELDS="${DISTILL_FIELDS:-mathematics,physics,chemistry}"
BOARD_MODEL="${BOARD_MODEL:-}"               # e.g. qwen2.5:14b to run the gold-first board after; "" = skip
REPUBLISH="${REPUBLISH:-1}"
BRAIN_BUCKET="${BRAIN_BUCKET:-gs://noetica-brains}"
SYNC_CORPUS="${SYNC_CORPUS:-1}"
CORPUS_LOCAL="${OCW_CORPUS:-$HOME/Downloads/MIT OCW/_corpus}"
LOG="$GCS/finish-corpus-run.log"
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=8)).replace(microsecond=0).isoformat())")}"

# ── Step 0 (local): get the captured corpus into GCS so the VM can vectorize it ────────────────────────
if [ "$SYNC_CORPUS" = "1" ]; then
  [ -d "$CORPUS_LOCAL" ] || { echo "FATAL: captured corpus not found at $CORPUS_LOCAL (set OCW_CORPUS)"; exit 1; }
  echo "# Step 0: syncing captured corpus → $GCS/corpus (first time ~23GB; incremental after). gcloud storage (no gsutil maxint bug)."
  gcloud storage rsync --recursive --exclude='\.DS_Store$' "$CORPUS_LOCAL" "$GCS/corpus"
fi

cat > /tmp/finish-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/fc-run.log 2>&1; set -x
export HOME=/root
GCS="$GCS"
( while true; do gsutil -q cp /var/log/fc-run.log "$LOG" 2>/dev/null; sleep 30; done ) & LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/fc-run.log "$LOG" 2>/dev/null||true; }

step "wait for NVIDIA driver"; for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done; nvidia-smi || echo "WARN no GPU"
step "install ollama (GPU) + nomic embed"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step "FATAL ollama"; exit 1; }
systemctl stop ollama 2>/dev/null || true
OLLAMA_NUM_PARALLEL=8 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done
ollama list | grep -q nomic-embed-text || { step "FATAL embed missing"; exit 1; }
[ -n "$BOARD_MODEL" ] && { for n in 1 2 3 4 5; do timeout 1800 ollama pull $BOARD_MODEL && break; sleep 8; done; }

step "install node + python"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step "FATAL node/py"; exit 1; }
PY=\$(which python3)
\$PY -m pip install -q sympy numpy scikit-learn pymupdf || \$PY -m pip install --break-system-packages -q sympy numpy scikit-learn pymupdf

step "pull code + brain + bank + CORPUS"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && timeout 600 npm ci || { step "FATAL code/npm"; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /opt/OCW || { step "FATAL brain"; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json || true
mkdir -p /opt/corpus && timeout 2400 gsutil -m rsync -r "\$GCS/corpus" /opt/corpus || { step "FATAL corpus pull"; exit 1; }
export OCW_BRAIN=/opt/OCW/_brain OLLAMA_HOST=http://127.0.0.1:11434

step "BUILD-CORPUS — depts=[${DEPTS:-ALL}] (vectorize the captured courses we never built)"
OCW_CORPUS=/opt/corpus OCW_BRAIN=/opt/OCW/_brain OCW_DEPTS="$DEPTS" BRAIN_CONCURRENCY=16 \
  timeout 18000 npx tsx scripts/build-corpus.ts 2>&1 | tail -200 || step "!! build-corpus \$?"
step "domain/field status after build:"
npx tsx -e "import('./lib/knowledge-domains.js').then(m=>{const d=m.domainStatus();console.log('courses:',d.totalCourses);for(const x of d.domains)console.log(' ',x.field,x.status,x.courses)})" || true

if [ "$DISTILL" = "1" ]; then
  step "DISTILL — STaR rejection-sampling → SFT JSONL from the GOLD ($DISTILL_FIELDS)"
  for f in \$(echo "$DISTILL_FIELDS" | tr ',' ' '); do
    TEACHER=${BOARD_MODEL:-qwen2.5:7b} STUDENT=${BOARD_MODEL:-qwen2.5:7b} \$PY scripts/distill_prep.py \$f --n 400 || step "!! distill \$f \$?"
  done
  gsutil -m cp /root/.noetica/distill/*.sft.jsonl "\$GCS/distill/" || true
fi

if [ "$REPUBLISH" = "1" ]; then
  step "RE-PUBLISH the (now fuller) academic brain → $BRAIN_BUCKET"
  mkdir -p /opt/am/dist/brains && tar -czf /opt/am/dist/brains/academic-brain.tar.gz -C /opt/OCW/_brain .
  NOETICA_BRAIN_BUCKET=$BRAIN_BUCKET BRAIN_VERSION=\$(date +%Y.%m.%d) DIST=/opt/am/dist/brains bash scripts/publish-brains.sh || step "!! republish (SA write perms on $BRAIN_BUCKET?)"
fi

# SAVE the freshly-built brain → the EVAL bucket (SA-writable, unlike noetica-brains) BEFORE the board, so an
# equations-recovered brain is never lost to a flaky/aborted board (the no-loss pattern). Skip with SAVE_BRAIN=0.
if [ "${SAVE_BRAIN:-1}" = "1" ]; then
  step "SAVE brain (no-loss) → \$GCS/brains/brain-${RUN_TAG:-build}.tar.gz"
  tar -czf /tmp/brain-save.tar.gz -C /opt/OCW/_brain . && gsutil -q cp /tmp/brain-save.tar.gz "\$GCS/brains/brain-${RUN_TAG:-build}.tar.gz" || step "!! brain save"
fi

if [ -n "$BOARD_MODEL" ]; then
  step "BOARD — $BOARD_MODEL, arms=${BOARD_ARMS:-baseline,brain,gate,champion}, n=100 (embeds wait: NOETICA_EMBED_TIMEOUT_MS via run-exam.sh)"
  MMLU_MODEL=$BOARD_MODEL MMLU_ARMS="${BOARD_ARMS:-baseline,brain,gate,champion}" MMLU_PER_SUBJECT=100 MMLU_SEED=1729 \
    MMLU_SUBJECTS=high_school_biology,conceptual_physics,electrical_engineering,college_chemistry,high_school_statistics,college_mathematics,abstract_algebra \
    bash scripts/run-exam.sh 2>&1 | tee /var/log/scoreboard.txt || echo "EVAL EXIT \$?"
  gsutil cp /var/log/scoreboard.txt "\$GCS/bench/board-$BOARD_MODEL-${RUN_TAG:-build}.txt" || true
  # upload the per-question transcript → retrains the learned council (scripts/meta_combiner.py) on CLEAN data
  T=\$(ls -t /root/.noetica/mmlu-brain-*.jsonl 2>/dev/null | head -1); [ -n "\$T" ] && gsutil -q cp "\$T" "\$GCS/bench/transcript-$BOARD_MODEL-${RUN_TAG:-build}.jsonl" || true
fi

step "DONE — self-deleting"
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/fc-run.log "$LOG"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE L4) — finish-corpus(depts=${DEPTS:-ALL}) distill=$DISTILL republish=$REPUBLISH board=${BOARD_MODEL:-none}, HARD SHUTDOWN $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --maintenance-policy=TERMINATE \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --metadata="install-nvidia-driver=True" --metadata-from-file startup-script=/tmp/finish-startup.sh \
  --boot-disk-size=250GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE

echo "# launched. watch:  gsutil cat $GCS/finish-corpus-run.log"
