#!/usr/bin/env bash
# gpu-smoke — cheap (~$0.10, ~3 min) validation that a GPU box (1) creates (quota), (2) has working drivers, and
# (3) runs ollama-nomic embedding FAST (not a silent CPU fallback). Writes GPU-SPEED to GCS, self-deletes. If this
# passes, the full brain build is safe; if it CPU-falls-back, we find out for a dime, not after hours.
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="gpu-smoke"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
TERM_TIME="$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=1)).isoformat())")"

cat > /tmp/gpu-smoke-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/smoke.log 2>&1; set -x
export HOME=/root
( while true; do gsutil -q cp /var/log/smoke.log "$GCS/gpu-smoke.log" 2>/dev/null; sleep 15; done ) &
echo "==== nvidia-smi ===="; nvidia-smi || echo "NO-GPU-DRIVER"
echo "==== install ollama ===="; curl -fsSL https://ollama.com/install.sh | sh
systemctl restart ollama 2>/dev/null || (ollama serve >/var/log/ollama.log 2>&1 &)
sleep 15
for n in 1 2 3 4 5; do ollama pull nomic-embed-text && break; sleep 8; done
echo "==== ollama gpu? (ollama ps shows GPU/CPU) ===="; sleep 2; ollama run nomic-embed-text "x" 2>/dev/null || true; ollama ps || true
apt-get install -y python3 >/dev/null 2>&1 || true
echo "==== EMBED SPEED TEST (500) ===="
python3 - <<'PY'
import json,urllib.request,time
texts=["sample passage %d about calculus, eigenvalues, photosynthesis and thermodynamics"%i for i in range(500)]
s=time.time()
for x in texts:
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/embeddings",json.dumps({"model":"nomic-embed-text","prompt":x}).encode(),{"Content-Type":"application/json"}),timeout=60).read()
d=time.time()-s
print("GPU-SPEED: 500 embeds in %.1fs = %.1f/sec  (>50/sec = GPU OK; ~3/sec = CPU fallback BAD)"%(d,500/d))
PY
gsutil cp /var/log/smoke.log "$GCS/gpu-smoke.log" || true
echo "==== self-delete ===="
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

# Try GPU types in availability order: L4 (g2) then T4 (n1+accel). Sweep zones; T4 has far more capacity.
# spec = "machine | accelerator-arg"  ('-' = none, g2 has L4 built-in)
SPECS=("g2-standard-8|-|L4" "n1-standard-8|type=nvidia-tesla-t4,count=1|T4")
ZONES="${ZONES:-us-central1-a us-central1-b us-central1-c us-east1-c us-east1-d us-east4-a us-west1-a us-west4-a}"
for spec in "${SPECS[@]}"; do
  IFS='|' read -r MACH ACCEL GNAME <<<"$spec"
  for z in $ZONES; do
    echo "# trying $GNAME ($MACH) in $z …"
    args=(--project="$PROJECT" --zone="$z" --machine-type="$MACH" --maintenance-policy=TERMINATE
      --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release
      --boot-disk-size=100GB --service-account="$SA" --scopes=cloud-platform
      --termination-time="$TERM_TIME" --instance-termination-action=DELETE
      --metadata-from-file startup-script=/tmp/gpu-smoke-startup.sh --metadata=install-nvidia-driver=True)
    [ "$ACCEL" != "-" ] && args+=(--accelerator="$ACCEL")
    if gcloud compute instances create "$VM" "${args[@]}" 2>/tmp/gpu-err.txt; then
      echo "# ✓ created $GNAME in $z. watch:  gsutil cat $GCS/gpu-smoke.log | grep GPU-SPEED"; exit 0
    fi
    grep -qiE "STOCKOUT|RESOURCE_POOL_EXHAUSTED|does not have enough" /tmp/gpu-err.txt && { echo "  stockout, next…"; continue; }
    grep -qiE "QUOTA|quota" /tmp/gpu-err.txt && { echo "  NO $GNAME QUOTA — skipping this type"; break; }
    echo "  error:"; tail -2 /tmp/gpu-err.txt; break
  done
done
echo "# NO GPU CAPACITY/QUOTA (L4 or T4) in any zone right now."; exit 2
