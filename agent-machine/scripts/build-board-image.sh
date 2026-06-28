#!/bin/bash
# build-board-image — bake a GCE custom image `board-base` with everything slow about a board boot
# pre-installed: node 20, the python sci-stack (numpy/scipy/sklearn/sympy/jsonschema/pypdf/gensim), ollama,
# AND the ollama models (qwen2.5:7b + nomic-embed-text). A board VM then boots from this image and the install
# steps in the startup become instant no-ops → ~3min boot instead of ~10min. One-time ~15min build.
#
# Why an image, not a GAR container: this project has no Cloud Build SA and sourceos-ci lacks artifactregistry
# .writer, so a container push needs an IAM grant. A custom image needs only the compute perms we already have.
# The docker/ container files stay ready for the GAR path once a Cloud Build SA is provisioned.
#
# Runs end-to-end (launch builder → wait for DONE → snapshot to image → delete builder). Background it.
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
VM="board-img-builder"
ZONE="${ZONE:-us-east1-b}"
IMAGE="${IMAGE:-board-base}"
DONE_MARK="$GCS/bench/board-img-DONE"
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

gcloud compute instances delete "$VM" --zone="$ZONE" --project="$PROJECT" --quiet 2>/dev/null || true
gcloud compute images delete "$IMAGE" --project="$PROJECT" --quiet 2>/dev/null || true   # rebuild fresh
gsutil rm "$DONE_MARK" 2>/dev/null || true

cat > /tmp/img-build.sh <<STARTUP
#!/bin/bash
exec >/var/log/imgbuild.log 2>&1; set -x
export HOME=/root DEBIAN_FRONTEND=noninteractive
( while true; do gsutil -q cp /var/log/imgbuild.log "$GCS/bench/board-img-build.log" 2>/dev/null; sleep 20; done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }
step "node 20 + python sci-stack"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git python3-pip || { step FATAL-node; exit 1; }
python3 -m pip install -q numpy scipy scikit-learn sympy jsonschema pypdf gensim || python3 -m pip install --break-system-packages -q numpy scipy scikit-learn sympy jsonschema pypdf gensim || step WARN-pip
step "ollama + BAKE models (the big win)"
curl -fsSL https://ollama.com/install.sh | sh || { step FATAL-ollama; exit 1; }
systemctl stop ollama 2>/dev/null || true
nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 12
for n in 1 2 3 4 5; do timeout 600 ollama pull nomic-embed-text && break; sleep 8; done
for n in 1 2 3 4 5; do timeout 1800 ollama pull qwen2.5:7b && break; sleep 8; done
ollama list
step "shrink: stop ollama, clean apt"
pkill ollama 2>/dev/null || true; systemctl disable ollama 2>/dev/null || true
apt-get clean; rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* 2>/dev/null || true
sync
step "DONE → marker + poweroff (disk preserved for imaging)"
echo OK > /root/imgdone && gsutil cp /root/imgdone "$DONE_MARK"
sleep 5; poweroff
STARTUP

echo "# launching image builder $VM in $ZONE …"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" --machine-type=c2d-standard-8 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --metadata-from-file startup-script=/tmp/img-build.sh \
  --boot-disk-size=60GB --service-account="$SA" --scopes=cloud-platform >/dev/null 2>&1 \
  || { echo "FATAL — could not create builder VM"; exit 1; }
echo "# builder launched — installing + baking models (~12min). Watch: gcloud storage cat $GCS/bench/board-img-build.log"

# wait for the DONE marker (builder powers off itself), then snapshot the disk to the image
for i in $(seq 1 60); do                       # up to ~30min
  if gsutil -q stat "$DONE_MARK" 2>/dev/null; then echo "# builder DONE (poll $i) — waiting for poweroff then imaging"; break; fi
  sleep 30
done
gsutil -q stat "$DONE_MARK" 2>/dev/null || { echo "FATAL — builder never signalled DONE; check board-img-build.log"; exit 1; }

# ensure the instance is TERMINATED (poweroff) before imaging its disk
for i in $(seq 1 20); do
  st=$(gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT" --format="value(status)" 2>/dev/null || echo "")
  [ "$st" = "TERMINATED" ] && break
  [ "$i" = "20" ] && gcloud compute instances stop "$VM" --zone="$ZONE" --project="$PROJECT" --quiet 2>/dev/null || true
  sleep 15
done

echo "# creating image $IMAGE from builder disk …"
gcloud compute images create "$IMAGE" --project="$PROJECT" \
  --source-disk="$VM" --source-disk-zone="$ZONE" --family=board-base \
  --description="board-base: node20 + python sci-stack + ollama + qwen2.5:7b + nomic-embed-text baked" \
  && echo "✓ image $IMAGE created" || { echo "FATAL — image create failed (compute.images.create perm?)"; exit 1; }

echo "# deleting builder VM"
gcloud compute instances delete "$VM" --zone="$ZONE" --project="$PROJECT" --quiet 2>/dev/null || true
echo "✅ board-base image ready — launch fast boards with: BOARD_IMAGE_NAME=$IMAGE bash scripts/gcp-board-cpu.sh"
