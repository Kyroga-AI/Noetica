#!/bin/bash
# gcp-board-fast — launch the board from the BAKED Artifact-Registry container (board-base) on Container-
# Optimized OS. Boot ≈ pull image + pull code/brain (~3min) vs ~10min installing everything every time. Same
# auto-resume loop + GCS checkpoint as gcp-board-cpu.sh; the slow installs (ollama+models, node, python) are
# baked into the image (docker/board-base.Dockerfile, built via docker/cloudbuild.yaml). Resumes the SAME
# ckpt-$RUN_TAG.jsonl, so it's a drop-in faster replacement for gcp-board-cpu.sh.
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
IMG="${BOARD_IMAGE:-us-central1-docker.pkg.dev/socioprophet-platform/socioprophet/board-base:latest}"
RUN_TAG="${RUN_TAG:-cpu}"; VM="board-$RUN_TAG"
ARMS="${BOARD_ARMS:-baseline,brain,notecard,gate,compute}"
MACHINE="${MACHINE:-c2d-standard-16}"
ZONES="${ZONES:-us-east1-b us-east1-c us-east1-d us-central1-a us-central1-b us-central1-c us-west1-a us-west1-b us-east4-a us-east4-c}"
STATUS="$GCS/bench/status-$RUN_TAG.json"
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=10)).replace(microsecond=0).isoformat())")

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(status)" 2>/dev/null | head -1)
case "$ex" in RUNNING|PROVISIONING|STAGING|REPAIRING) echo "ABORT — $VM is $ex (active; it auto-resumes itself, nothing to do)"; exit 0;; esac   # only an ACTIVE VM blocks; a TERMINATED/STOPPING one must not
echo "# board-fast · $IMG · $MACHINE · arms=$ARMS · auto-resume → done==total"

for Z in $ZONES; do
  echo "  trying $VM ($MACHINE) in $Z"
  if gcloud compute instances create-with-container "$VM" --project="$PROJECT" --zone="$Z" --machine-type="$MACHINE" \
      --container-image="$IMG" --container-stdin --container-tty \
      --container-env="GCS=$GCS,RUN_TAG=$RUN_TAG,BOARD_ARMS=$ARMS,BOARD_MODEL=${BOARD_MODEL:-qwen2.5:7b},PER=${PER:-15},STALL_MIN=${STALL_MIN:-15}" \
      --container-restart-policy=never \
      --boot-disk-size=120GB --service-account="$SA" --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE >/dev/null 2>&1; then
    echo "=== board-fast LAUNCHED in $Z — countdown: gcloud storage cat $STATUS ==="; exit 0
  fi
  echo "    $Z failed (stockout?), next"
done
echo "FATAL — all zones failed"; exit 1
