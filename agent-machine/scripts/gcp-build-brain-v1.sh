#!/usr/bin/env bash
# gcp-build-brain-v1 — build the CLEAN brain v1 on a GPU box (ollama-nomic-on-GPU = fast + production-compatible).
# Full OCW corpus → material-aware clean chunker (sliding@15% overlap + heading, the principled default) → embed
# (nomic-768) → per-field brain in the board's exact format → push brain-v1.tar.gz to GCS → self-delete.
# Tries L4 then T4, sweeping zones (GPU stockouts are common). ABORTS FAST if the GPU isn't actually used (so a
# silent CPU fallback can't burn hours). No board here — this is the build; chunking variants get compared on the
# real board afterward.
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
VM="${VM_NAME:-brain-v1}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
CORPUS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
OVERLAP="${CHUNK_OVERLAP:-0.15}"; MODE="${CHUNK_MODE:-sliding}"
TERM_TIME="$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=8)).isoformat())")"

cat > /tmp/brain-v1-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/brain.log 2>&1; set -x
export HOME=/root
GCS="$GCS"; CORPUS="$CORPUS"; MODE="$MODE"; OVERLAP="$OVERLAP"
( while true; do gsutil -q cp /var/log/brain.log "\$GCS/brain-v1.log" 2>/dev/null; sleep 30; done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/brain.log "\$GCS/brain-v1.log" 2>/dev/null||true; }

step "GPU check (abort if no driver)"; nvidia-smi || { echo "FATAL-NO-GPU"; exit 1; }
step "install ollama"; curl -fsSL https://ollama.com/install.sh | sh
systemctl restart ollama 2>/dev/null || (ollama serve >/var/log/ollama.log 2>&1 &)
sleep 15
for n in 1 2 3 4 5; do ollama pull nomic-embed-text && break; sleep 8; done
# GPU-SPEED GUARD: probe the BATCH path (the one embed-chunks.ts uses, /api/embed input:[64]). Abort only on a
# clear CPU fallback (<10/sec); the 8h guard covers the pessimistic ~17/sec case.
SPEED=\$(python3 - <<'PY'
import json,urllib.request,time
texts=["probe %d eigenvalue derivative photosynthesis thermodynamics"%i for i in range(640)]
s=time.time()
for b in range(0,640,64):
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/embed",json.dumps({"model":"nomic-embed-text","input":texts[b:b+64]}).encode(),{"Content-Type":"application/json"}),timeout=120).read()
print(int(640/(time.time()-s)))
PY
)
echo "EMBED-SPEED(batch)=\$SPEED/sec"
[ "\$SPEED" -lt 10 ] && { echo "FATAL-CPU-FALLBACK (\$SPEED/sec) — GPU not used; aborting"; exit 1; }

step "install node + python + sentence-transformers"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git python3-pip
pip3 install --break-system-packages sentence-transformers einops || pip3 install sentence-transformers einops

step "pull code + FULL corpus"
mkdir -p /opt/am && gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && npm ci
mkdir -p /opt/courses && gsutil -m cp -r "\$CORPUS/*" /opt/courses/    # bulk recursive download (reliable, parallel)
echo "courses pulled: \$(ls /opt/courses | wc -l)"

step "chunk (\$MODE @ \$OVERLAP + heading) — full corpus"
CHUNK_MODE="\$MODE" CHUNK_OVERLAP="\$OVERLAP" python3 scripts/chunk-corpus.py /opt/courses /opt/chunks
echo "fields: \$(ls /opt/chunks | wc -l) | total chunks: \$(cat /opt/chunks/*.jsonl | wc -l)"

step "embed (nomic-768, GPU) → brain v1"
OLLAMA_HOST=http://127.0.0.1:11434 EMBED_BATCH=64 BRAIN_CONCURRENCY=24 npx tsx scripts/embed-chunks.ts /opt/chunks /opt/brain-v1

step "package + push brain-v1.tar.gz"
echo "{\"config\":\"\$MODE@\$OVERLAP+heading\",\"embed\":\"nomic-768\",\"fields\":\$(ls /opt/brain-v1|wc -l),\"vectors\":\$(cat /opt/brain-v1/*/*.jsonl|wc -l),\"built\":\"\$(date -u +%FT%TZ)\"}" > /opt/brain-v1/_manifest.json
tar czf /opt/brain-v1.tar.gz -C /opt brain-v1 && gsutil cp /opt/brain-v1.tar.gz "\$GCS/brain-v1.tar.gz"
gsutil cp /opt/brain-v1/_manifest.json "\$GCS/brain-v1-manifest.json"
cat /opt/brain-v1/_manifest.json

step "DONE — self-deleting"; gsutil -q cp /var/log/brain.log "\$GCS/brain-v1.log"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

SPECS=("g2-standard-8|-|L4" "n1-standard-8|type=nvidia-tesla-t4,count=1|T4")
ZONES="${ZONES:-us-central1-a us-central1-b us-central1-c us-east1-c us-east1-d us-east4-a us-west1-a us-west4-a}"
for spec in "${SPECS[@]}"; do
  IFS='|' read -r MACH ACCEL GNAME <<<"$spec"
  for z in $ZONES; do
    echo "# trying brain-v1 on $GNAME ($MACH) in $z …"
    args=(--project="$PROJECT" --zone="$z" --machine-type="$MACH" --maintenance-policy=TERMINATE
      --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release
      --boot-disk-size=300GB --service-account="$SA" --scopes=cloud-platform
      --termination-time="$TERM_TIME" --instance-termination-action=DELETE
      --metadata-from-file startup-script=/tmp/brain-v1-startup.sh --metadata=install-nvidia-driver=True)
    [ "$ACCEL" != "-" ] && args+=(--accelerator="$ACCEL")
    if gcloud compute instances create "$VM" "${args[@]}" 2>/tmp/bv-err.txt; then
      echo "# ✓ brain-v1 building on $GNAME in $z. watch: gsutil cat $GCS/brain-v1.log | grep -E '====|SPEED|fields|vectors'"; exit 0; fi
    grep -qiE "STOCKOUT|RESOURCE_POOL_EXHAUSTED|does not have enough" /tmp/bv-err.txt && { echo "  stockout, next…"; continue; }
    grep -qiE "quota" /tmp/bv-err.txt && { echo "  no $GNAME quota"; break; }
    echo "  error:"; tail -2 /tmp/bv-err.txt; break
  done
done
echo "# NO GPU CAPACITY right now."; exit 2
