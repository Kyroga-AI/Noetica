#!/bin/bash
# gcp-build-domains — JOB A: build the medicine + legal brain fields on an L4 and SAVE the brain to a
# bucket the VM CAN write (the eval bucket), BEFORE anything else can fail. No board here — the board is a
# separate job (gcp-gpu-eval.sh) on the saved brain, so a long board can never eat the build, and a failed
# public-publish can never throw the build away (the bug that lost the last run).
#
# Saves after EACH field, so even a mid-run crash banks what's done. Public re-publish to gs://noetica-brains
# is optional + fail-tolerant (the SA may lack write there — then `gsutil cp` the saved tar from your Mac).
#
# PREREQ: sync-code-to-gcs.sh first (gold-first code), $GCS/brain-complete.tar.gz, $GCS/mmlu_stem.json.
# Usage:  GCP_PROJECT=socioprophet-platform bash scripts/gcp-build-domains.sh
#         # options:  CANON=1 (also fetch canonical US Code+CFR)   LEGAL_SCOPE=all   REPUBLISH=1
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-build-domains}"
MACHINE="${MACHINE:-g2-standard-8}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
SAVED="${SAVED:-$GCS/brain-domains.tar.gz}"   # where the built brain is BANKED (eval bucket; SA-writable)
CANON="${CANON:-0}"; LEGAL_SCOPE="${LEGAL_SCOPE:-federal}"; LEGAL_LIMIT="${LEGAL_LIMIT:-120000}"
CAP_SOURCES="${CAP_SOURCES:-free-law/nh}"
REPUBLISH="${REPUBLISH:-0}"; BRAIN_BUCKET="${BRAIN_BUCKET:-gs://noetica-brains}"
LOG="$GCS/build-domains-run.log"
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=6)).replace(microsecond=0).isoformat())")}"

cat > /tmp/build-domains-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/bd-run.log 2>&1; set -x
export HOME=/root
GCS="$GCS"; SAVED="$SAVED"
( while true; do gsutil -q cp /var/log/bd-run.log "$LOG" 2>/dev/null; sleep 30; done ) & LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/bd-run.log "$LOG" 2>/dev/null||true; }
# SAVE the brain to the eval bucket — called after EACH field so work is never lost.
save_brain(){ step "SAVE brain → \$SAVED (\$1)"; tar -czf /tmp/brain.tgz -C /opt/OCW/_brain . && gsutil -q cp /tmp/brain.tgz "\$SAVED" && step "saved ✓"; }

step "wait for driver + install ollama (GPU) + nomic"
for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done; nvidia-smi || echo "WARN no GPU"
timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' || { step "FATAL ollama"; exit 1; }
systemctl stop ollama 2>/dev/null||true; OLLAMA_NUM_PARALLEL=8 OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done
ollama list | grep -q nomic-embed-text || { step "FATAL embed"; exit 1; }

step "install node + python + datasets"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step "FATAL node/py"; exit 1; }
PY=\$(which python3); \$PY -m pip install -q datasets pyarrow || \$PY -m pip install --break-system-packages -q datasets pyarrow

step "pull code + brain"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && timeout 600 npm ci || { step "FATAL code/npm"; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /opt/OCW || { step "FATAL brain"; exit 1; }
export OCW_BRAIN=/opt/OCW/_brain OLLAMA_HOST=http://127.0.0.1:11434

step "BUILD medicine (MedRAG textbooks → vectorize on GPU)"
\$PY scripts/fetch_medical_corpus.py all || step "!! medicine fetch \$?"
\$PY scripts/vectorize_field.py medicine || step "!! medicine vectorize \$?"
save_brain "after medicine"

step "BUILD legal — statutes + code + caselaw${CANON:+ + canon} (scope=$LEGAL_SCOPE)"
LEGAL_SCOPE=$LEGAL_SCOPE LEGAL_LIMIT=$LEGAL_LIMIT CANON=$CANON CAP_SOURCES="$CAP_SOURCES" \$PY scripts/fetch_legal_corpus.py || step "!! legal fetch \$?"
\$PY scripts/vectorize_field.py legal || step "!! legal vectorize \$?"
save_brain "after legal"

step "domain status:"
npx tsx -e "import('./lib/knowledge-domains.js').then(m=>{const d=m.domainStatus();for(const x of d.domains)console.log(' ',x.field,x.status,x.courses)})" || true

if [ "$REPUBLISH" = "1" ]; then
  step "RE-PUBLISH → $BRAIN_BUCKET (optional; fail-tolerant)"
  mkdir -p /opt/am/dist/brains && cp /tmp/brain.tgz /opt/am/dist/brains/academic-brain.tar.gz
  NOETICA_BRAIN_BUCKET=$BRAIN_BUCKET BRAIN_VERSION=\$(date +%Y.%m.%d) DIST=/opt/am/dist/brains bash scripts/publish-brains.sh \
    || step "!! republish failed — the brain is SAFE at \$SAVED; gsutil cp it to $BRAIN_BUCKET from a box with write perms"
fi

step "DONE — brain banked at \$SAVED. Run the board: gcp-gpu-eval.sh with BRAIN_TGZ=\$SAVED. Self-deleting."
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/bd-run.log "$LOG"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE L4) — JOB A: build medicine+legal, SAVE → $SAVED (canon=$CANON, scope=$LEGAL_SCOPE), HARD SHUTDOWN $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --maintenance-policy=TERMINATE \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --metadata="install-nvidia-driver=True" --metadata-from-file startup-script=/tmp/build-domains-startup.sh \
  --boot-disk-size=160GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE
echo "# launched. watch:  gsutil cat $GCS/build-domains-run.log   ·   brain banks to $SAVED after each field"
echo "# THEN (Job B, board):  BRAIN_TGZ=$SAVED ARMS=baseline,brain,gate,champion PER=50 bash scripts/gcp-gpu-eval.sh"
