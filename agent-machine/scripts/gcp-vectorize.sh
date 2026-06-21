#!/bin/bash
# gcp-vectorize — vectorize the full MMLU-domain brain on a cloud box in a few hours instead
# of days on the laptop, push the brain to GCS, tear the VM down.
#
# Why: laptop grind is ~8-10 courses/hr (EECS alone is 199). A 32-vCPU box at conc=16 does
# the remaining ~480 courses in ~3-5h. nomic-embed is CPU-only, so no GPU needed.
# Cost: c2d-standard-32 ≈ $1.2/hr on-demand × ~5h + egress ≈ ~$6-8.  (Matches the BearBrowser
# GCP pattern.)  Run from a machine with `gcloud` authed and the project set.
#
# PREREQS (one-time):
#   1. The captured corpus substance must be in GCS so the VM can pull it:
#        gsutil -m rsync -r "$HOME/Downloads/MIT OCW/_corpus" gs://sourceos-artifacts-socioprophet/ocw-corpus/_corpus
#      (~23GB one-time upload; or reuse the existing state.tar if it already holds _corpus.)
#   2. Set NOETICA_REPO to a clone URL the VM can reach (or swap to a gsutil copy of agent-machine/).
set -euo pipefail
PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-ocw-vectorize}"
MACHINE="${MACHINE:-c2d-standard-32}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
NOETICA_REPO="${NOETICA_REPO:?set NOETICA_REPO to a clone URL the VM can reach}"

echo "# creating $VM ($MACHINE) in $ZONE …"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=150GB --scopes=storage-rw

trap 'gcloud compute instances delete "$VM" --project="$PROJECT" --zone="$ZONE" --quiet' EXIT

echo "# waiting for ssh …"; sleep 30
gcloud compute ssh "$VM" --project="$PROJECT" --zone="$ZONE" --command="bash -s" <<REMOTE
  set -euo pipefail
  curl -fsSL https://ollama.com/install.sh | sh
  nohup ollama serve >/tmp/ollama.log 2>&1 & sleep 5
  ollama pull nomic-embed-text
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs git
  git clone "$NOETICA_REPO" noetica && cd noetica/agent-machine && npm ci
  mkdir -p ~/OCW && gsutil -m rsync -r "$GCS/_corpus" ~/OCW/_corpus
  OLLAMA_HOST=http://127.0.0.1:11434 OCW_CORPUS=~/OCW/_corpus OCW_BRAIN=~/OCW/_brain \
    OCW_DEPTS=18,8,5,7,20,6,12 BRAIN_CONCURRENCY=16 npx tsx scripts/build-corpus.ts
  tar czf ~/brain.tar.gz -C ~/OCW _brain
  gsutil cp ~/brain.tar.gz "$GCS/brain.tar.gz"
  echo "BRAIN PUSHED to $GCS/brain.tar.gz"
REMOTE

echo "# done — pull with:  gsutil cp $GCS/brain.tar.gz .  &&  tar xzf brain.tar.gz"
