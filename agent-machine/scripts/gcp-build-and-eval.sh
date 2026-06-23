#!/bin/bash
# gcp-build-and-eval — ONE GPU job that gets it right end to end:
#   1. build the medicine + legal brain fields (fetch + vectorize on the L4 — 20-50x faster than CPU)
#   2. (optional) re-package + re-publish the academic brain to the public brain service so installs update
#   3. run the REAL board: the gold-first brain, the proper arms (baseline,brain,gate,champion), n=100,
#      same model as the stale 63.6% board so the delta is attributable to the gold-first re-curation.
#
# Autonomous startup-script (no SSH): installs driver + ollama(GPU) + model, pulls code+brain+bank from
# GCS, builds the domains, runs the board, pushes the scoreboard, self-deletes. HARD-SHUTDOWN guard.
#
# PREREQ: sync the LATEST code first  (bash scripts/sync-code-to-gcs.sh)  so the VM gets the gold-first
#         brain + the gold-first bench. Also: $GCS/brain-complete.tar.gz, $GCS/mmlu_stem.json.
# Usage:  GCP_PROJECT=socioprophet-platform bash scripts/gcp-build-and-eval.sh
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-build-eval}"
MACHINE="${MACHINE:-g2-standard-8}"          # 1x NVIDIA L4 (24GB) — fits 7B/14B + headroom for embeds
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
MODEL="${MODEL:-qwen2.5:7b}"                  # SAME as the stale board → the delta is the gold-first fix, not the model
ARMS="${ARMS:-baseline,brain,gate,champion}" # the FULL technique, not just baseline,brain
PER="${PER:-100}"                             # a real sample size, not n=20
MAXCHUNKS="${MAXCHUNKS:-30000}"
SUBJECTS="${SUBJECTS:-high_school_biology,conceptual_physics,electrical_engineering,college_chemistry,high_school_statistics,college_mathematics,abstract_algebra}"
BUILD_DOMAINS="${BUILD_DOMAINS:-1}"           # fetch+vectorize medicine + legal
REPUBLISH="${REPUBLISH:-1}"                   # re-publish the academic brain to gs://noetica-brains
BRAIN_BUCKET="${BRAIN_BUCKET:-gs://noetica-brains}"
LEGAL_LIMIT="${LEGAL_LIMIT:-60000}"
LOG="$GCS/build-eval-run.log"
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=4)).replace(microsecond=0).isoformat())")}"

cat > /tmp/build-eval-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/be-run.log 2>&1; set -x
export HOME=/root
GCS="$GCS"
( while true; do gsutil -q cp /var/log/be-run.log "$LOG" 2>/dev/null; sleep 30; done ) & LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/be-run.log "$LOG" 2>/dev/null||true; }

step "wait for NVIDIA driver"
for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
nvidia-smi || echo "WARN: no GPU visible (will run slow)"

step "install ollama (GPU)"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step "FATAL ollama install"; exit 1; }
systemctl stop ollama 2>/dev/null || true
OLLAMA_NUM_PARALLEL=8 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 &
sleep 12
for n in 1 2 3 4 5; do timeout 1200 ollama pull $MODEL && break; step "model pull retry \$n"; sleep 8; done
ollama list | grep -q "$MODEL" || { step "FATAL: model $MODEL missing"; exit 1; }
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; step "embed retry \$n"; sleep 8; done
ollama list | grep -q nomic-embed-text || { step "FATAL: embed model missing"; exit 1; }

step "install node + python + datasets"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step "FATAL: node/python install"; exit 1; }
PY=\$(which python3)
\$PY -m pip install -q sympy numpy scikit-learn datasets pyarrow || \$PY -m pip install --break-system-packages -q sympy numpy scikit-learn datasets pyarrow
\$PY -c "import sympy,numpy,sklearn,datasets" || { step "FATAL: python deps not importable"; exit 1; }

step "pull code + npm ci"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ || { step "FATAL: code pull"; exit 1; }
cd /opt/am && timeout 600 npm ci || { step "FATAL: npm ci"; exit 1; }

step "pull brain + bank"
mkdir -p /opt/OCW && timeout 900 gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz || { step "FATAL: brain pull"; exit 1; }
tar xzf /tmp/b.tgz -C /opt/OCW || { step "FATAL: brain extract"; exit 1; }
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json
export OCW_BRAIN=/opt/OCW/_brain OLLAMA_HOST=http://127.0.0.1:11434

if [ "$BUILD_DOMAINS" = "1" ]; then
  step "BUILD medicine (fetch MedRAG textbooks + vectorize on GPU)"
  \$PY scripts/fetch_medical_corpus.py all || step "!! medicine fetch \$?"
  \$PY scripts/vectorize_field.py medicine || step "!! medicine vectorize \$?"
  step "BUILD legal (fetch Caselaw Access Project + vectorize)"
  LEGAL_LIMIT=$LEGAL_LIMIT \$PY scripts/fetch_legal_corpus.py all || step "!! legal fetch \$?"
  \$PY scripts/vectorize_field.py legal || step "!! legal vectorize \$?"
  step "domain status after build:"
  npx tsx -e "import('./lib/knowledge-domains.js').then(m=>{for(const d of m.domainStatus().domains)console.log(' '+d.field,d.status,d.courses)})" || true
fi

if [ "$REPUBLISH" = "1" ]; then
  step "RE-PUBLISH academic brain (now incl. medicine/legal) → $BRAIN_BUCKET"
  mkdir -p /opt/am/dist/brains
  tar -czf /opt/am/dist/brains/academic-brain.tar.gz -C /opt/OCW/_brain . || step "!! repackage \$?"
  NOETICA_BRAIN_BUCKET=$BRAIN_BUCKET BRAIN_VERSION=\$(date +%Y.%m.%d) DIST=/opt/am/dist/brains \
    bash scripts/publish-brains.sh || step "!! republish failed (SA may lack write on $BRAIN_BUCKET — re-publish from a dev box)"
fi

step "RUN BOARD — model=$MODEL arms=$ARMS n=$PER (GOLD-FIRST brain)"
MMLU_MODEL=$MODEL MMLU_ARMS=$ARMS MMLU_PER_SUBJECT=$PER MMLU_SEED=1729 MMLU_SUBJECTS=$SUBJECTS MMLU_MAX_CHUNKS=$MAXCHUNKS MMLU_CONC=${CONC:-8} MMLU_CISC=${CISC:-1} MMLU_HYBRID=${HYBRID:-1} MMLU_MANIP=${MANIP:-1} MMLU_COUNCIL_V2=${COUNCIL_V2:-1} \
  bash scripts/run-exam.sh 2>&1 | tee /var/log/scoreboard.txt || echo "EVAL EXITED \$?"
gsutil cp /var/log/scoreboard.txt "\$GCS/bench/board-goldfirst-$MODEL.txt" || true
LATEST_T=\$(ls -t /root/.noetica/mmlu-brain-*.jsonl 2>/dev/null | head -1)
[ -n "\$LATEST_T" ] && gsutil cp "\$LATEST_T" "\$GCS/bench/transcript-goldfirst-$MODEL.jsonl" || true

step "DONE — self-deleting"
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/be-run.log "$LOG"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

ACCELFLAG=""; [ -n "${ACCEL:-}" ] && ACCELFLAG="--accelerator=type=$ACCEL,count=1"
echo "# creating $VM ($MACHINE ${ACCEL:-L4}) — build(medicine,legal) + republish=$REPUBLISH + board($MODEL, $ARMS, n=$PER), HARD SHUTDOWN $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --maintenance-policy=TERMINATE $ACCELFLAG \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --metadata="install-nvidia-driver=True" --metadata-from-file startup-script=/tmp/build-eval-startup.sh \
  --boot-disk-size=160GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE

echo "# launched. watch:  gsutil cat $GCS/build-eval-run.log"
echo "# board → $GCS/bench/board-goldfirst-$MODEL.txt   ·   compare to the stale 63.6% champion board"
