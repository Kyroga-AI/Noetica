#!/usr/bin/env bash
# gcp-chunk-ab — decide the brain-v1 chunking config by EXPERIMENT, on a cheap self-deleting box. For each of 6
# configs (a naive fixed baseline + sliding@{0,15,30} + semantic@{15,30}) it: chunk → embed (nomic-768) → run the
# board (baseline vs brain) over the STEM MMLU subjects, and records the brain-arm accuracy. The config whose
# brain answers best wins; we then do ONE full GPU build with it. No SSH: a startup-script does everything, streams
# its log to GCS, writes a results table, and self-deletes. Hard-shutdown guard as a cost backstop.
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-chunk-ab}"
MACHINE="${MACHINE:-n2-standard-32}"          # CPU box (no GPU-driver hassle); board uses the fast model
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
CORPUS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
MODEL="${MMLU_MODEL:-qwen2.5:7b}"
PER="${MMLU_PER_SUBJECT:-20}"                  # questions/subject (n>=20 floor for a stable A/B signal)
SAMPLE_RE='/(18|8|5|6|7|9|2|3|10|12|20)-'     # STEM departments for the sample (math/phys/chem/eecs/bio/...)
SAMPLE_N="${SAMPLE_N:-160}"
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=4)).isoformat())")}"

cat > /tmp/chunk-ab-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/ab.log 2>&1; set -x
export HOME=/root
GCS="$GCS"; CORPUS="$CORPUS"; MODEL="$MODEL"; PER="$PER"
( while true; do gsutil -q cp /var/log/ab.log "\$GCS/chunk-ab.log" 2>/dev/null; sleep 30; done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/ab.log "\$GCS/chunk-ab.log" 2>/dev/null||true; }

step "install ollama + models"
curl -fsSL https://ollama.com/install.sh | sh
systemctl restart ollama 2>/dev/null || (ollama serve >/var/log/ollama.log 2>&1 &)
sleep 12
for n in 1 2 3 4 5; do ollama pull nomic-embed-text && break; sleep 8; done
for n in 1 2 3 4 5; do ollama pull "\$MODEL" && break; sleep 8; done
ollama list | grep -q nomic-embed-text || { echo FATAL-no-embed; exit 1; }

step "install node + python + sentence-transformers (semantic chunking)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git python3-pip
pip3 install --break-system-packages sentence-transformers || pip3 install sentence-transformers

step "pull code + STEM course sample (\$SAMPLE_N courses)"
mkdir -p /opt/am && gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && npm ci
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/mmlu_stem.json" /root/.noetica/corpus/benchmarks/mmlu_stem.json   # the board's question bank
mkdir -p /opt/sample
gsutil ls "\$CORPUS/" | grep -E '$SAMPLE_RE' | head -$SAMPLE_N | gsutil -m cp -I /opt/sample/ 2>/dev/null
echo "sample courses: \$(ls /opt/sample | wc -l)"

# config table: name | tool(args)
run_cfg () {
  local name="\$1"; shift
  step "CONFIG \$name — chunk"
  rm -rf /opt/ck-\$name /opt/br-\$name
  "\$@" /opt/sample /opt/ck-\$name || { echo "chunk \$name FAILED"; return; }
  step "CONFIG \$name — embed"
  OLLAMA_HOST=http://127.0.0.1:11434 EMBED_BATCH=64 npx tsx scripts/embed-chunks.ts /opt/ck-\$name /opt/br-\$name || { echo "embed \$name FAILED"; return; }
  step "CONFIG \$name — board (baseline vs brain, \$PER/subj)"
  OCW_BRAIN=/opt/br-\$name OLLAMA_HOST=http://127.0.0.1:11434 MMLU_MODEL="\$MODEL" \
    MMLU_ARMS=baseline,brain MMLU_PER_SUBJECT="\$PER" MMLU_SEED=1729 \
    MMLU_CHECKPOINT=/opt/ab-\$name.jsonl npx tsx scripts/mmlu-brain-bench.ts >/opt/board-\$name.log 2>&1 || echo "board \$name exited \$?"
  # accuracy from the checkpoint: brain_pred vs gold, baseline_pred vs gold
  python3 - "\$name" /opt/ab-\$name.jsonl <<'PY'
import sys,json
name,fp=sys.argv[1],sys.argv[2]
b=t=n=0
try:
  for ln in open(fp):
    r=json.loads(ln)
    if 'brain_ok' not in r and 'baseline_ok' not in r: continue
    n+=1
    if r.get('brain_ok'): b+=1
    if r.get('baseline_ok'): t+=1
  print(f"RESULT\t{name}\tn={n}\tbaseline={t/n:.3f}\tbrain={b/n:.3f}\tlift={(b-t)/n:+.3f}" if n else f"RESULT\t{name}\tNO-DATA")
except Exception as e: print(f"RESULT\t{name}\tERR\t{e}")
PY
}

step "RUN 6 CONFIGS"
run_cfg baseline    python3 scripts/clean-corpus-v1.py
CHUNK_MODE=sliding  CHUNK_OVERLAP=0.0  run_cfg sliding-00 python3 scripts/chunk-corpus.py
CHUNK_MODE=sliding  CHUNK_OVERLAP=0.15 run_cfg sliding-15 python3 scripts/chunk-corpus.py
CHUNK_MODE=sliding  CHUNK_OVERLAP=0.30 run_cfg sliding-30 python3 scripts/chunk-corpus.py
CHUNK_MODE=semantic CHUNK_OVERLAP=0.15 run_cfg semantic-15 python3 scripts/chunk-corpus.py
CHUNK_MODE=semantic CHUNK_OVERLAP=0.30 run_cfg semantic-30 python3 scripts/chunk-corpus.py

step "RESULTS"
echo "=========== CHUNK A/B RESULTS (brain-arm accuracy by config) ==========="
grep -h '^RESULT' /var/log/ab.log | sort -t= -k4 -rn | tee /opt/chunk-ab-results.tsv
gsutil cp /opt/chunk-ab-results.tsv "\$GCS/chunk-ab-results.tsv"

step "DONE — self-deleting"
gsutil -q cp /var/log/ab.log "\$GCS/chunk-ab.log" || true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE) — 6-config chunk A/B, hard-shutdown $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=200GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE \
  --metadata-from-file startup-script=/tmp/chunk-ab-startup.sh
echo "# launched. watch:  gsutil cat $GCS/chunk-ab.log   |   results: $GCS/chunk-ab-results.tsv"
