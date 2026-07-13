#!/usr/bin/env bash
# gcp-prove-frontier — one command: spin up an L4 GPU mesh node on GCP, prove the sovereign mesh
# matches the frontier (Claude/GPT arms), keep the artifact, and tear the node down. No lingering spend.
#
#   ./gcp-prove-frontier.sh [n]        # n = number of head-to-head problems (default 8)
#
# Preconditions (yours to provide — this script never holds credentials):
#   gcloud auth login                            # an active account
#   export GCP_PROJECT=<your-project>            # or: gcloud config set project <p>
#   # an L4 quota in the zone (GPUS_ALL_REGIONS / NVIDIA_L4_GPUS >= 1) — g2 machines bundle the L4
#   export ANTHROPIC_API_KEY=...   OPENAI_API_KEY=...   # frontier arms (proof still runs mesh-only without)
#
# Tunables: GCP_ZONE (us-central1-a), MESH_SKU (g2-standard-8), MESH_MODEL (qwen2.5-coder:7b),
#           MESH_NODE (noetica-proof), MESH_SPOT (1 → Spot VM, cheapest; 0 → on-demand).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${GCP_ZONE:-us-central1-a}"
NAME="${MESH_NODE:-noetica-proof}"
MODEL="${MESH_MODEL:-qwen2.5-coder:7b}"
SPOT="${MESH_SPOT:-1}"
N="${1:-8}"
FW="${NAME}-ollama"

# Image: GCP's driver-READY Ubuntu accelerator image (NVIDIA driver preinstalled), so the node boots
# straight into a working GPU — no boot-time driver compile to flake. cloud-init.sh detects the present
# driver (nvidia-smi) and skips its install path, so this is a clean no-op there. (Rocky's "optimized-nvidia"
# images 404 for consumer projects; stock rhel-9 works too but relies on the fragile boot-time dnf/dkms
# build — override back to it with MESH_IMAGE_FAMILY=rhel-9 MESH_IMAGE_PROJECT=rhel-cloud if ever needed.)
IMG_FAMILY="${MESH_IMAGE_FAMILY:-ubuntu-accelerator-2204-amd64-with-nvidia-580}"
IMG_PROJECT="${MESH_IMAGE_PROJECT:-ubuntu-os-accelerator-images}"

# GPU selection. L4 is bundled into the g2 machine family (no --accelerator). Everything else
# (V100/P100/T4/A100) attaches to an n1/a2 machine via --accelerator. Pick with MESH_GPU:
#   MESH_GPU=l4    → g2-standard-8            (needs NVIDIA_L4 quota)
#   MESH_GPU=v100  → n1-standard-8 + 1×V100   (default — matches the quota we have)
#   MESH_GPU=t4|p100 likewise; a100 → a2-highgpu-1g. Override CPU/RAM with MESH_SKU.
MESH_GPU="${MESH_GPU:-v100}"
declare -a ACCEL_FLAGS=()
case "$MESH_GPU" in
  l4)   SKU="${MESH_SKU:-g2-standard-8}" ;;
  v100) SKU="${MESH_SKU:-n1-standard-8}"; ACCEL_FLAGS=(--accelerator="type=nvidia-tesla-v100,count=1") ;;
  t4)   SKU="${MESH_SKU:-n1-standard-8}"; ACCEL_FLAGS=(--accelerator="type=nvidia-tesla-t4,count=1") ;;
  p100) SKU="${MESH_SKU:-n1-standard-8}"; ACCEL_FLAGS=(--accelerator="type=nvidia-tesla-p100,count=1") ;;
  a100) SKU="${MESH_SKU:-a2-highgpu-1g}" ;;
  *)    echo "unknown MESH_GPU=$MESH_GPU (use l4|v100|t4|p100|a100)" >&2; exit 1 ;;
esac

die() { echo "✗ $*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || die "gcloud not installed"
[ -n "$PROJECT" ] || die "no project — export GCP_PROJECT=<id> or run: gcloud config set project <id>"
gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . \
  || die "no active gcloud auth — run: gcloud auth login"
[ -f "$HERE/cloud-init.sh" ] || die "missing $HERE/cloud-init.sh"
MYIP="$(curl -fsS -m10 ifconfig.me 2>/dev/null || true)"
[ -n "$MYIP" ] || die "could not determine this host's public IP (needed to firewall the node)"
echo "▸ project=$PROJECT zone=$ZONE sku=$SKU model=$MODEL spot=$SPOT problems=$N"
echo "▸ node ollama :11434 will be opened ONLY to ${MYIP}/32"

# ── Teardown trap — fires on any exit so we never leave a GPU running ─────────
cleanup() {
  echo "▸ teardown"
  gcloud compute instances delete "$NAME" --zone "$ZONE" --project "$PROJECT" --quiet 2>/dev/null || true
  gcloud compute firewall-rules delete "$FW" --project "$PROJECT" --quiet 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 1. Firewall: expose 11434 to this host only ──────────────────────────────
gcloud compute firewall-rules create "$FW" --project "$PROJECT" \
  --direction INGRESS --action ALLOW --rules tcp:11434 \
  --source-ranges "${MYIP}/32" --target-tags noetica-proof >/dev/null \
  || die "firewall create failed"

# ── 2. Create the GPU node (RHEL image + boot-time driver via startup script) ─
# Use --image-family: for standard images (rhel-9) the family view resolves the correct arch-specific,
# newest image. (Don't filter images by family=… — gcloud treats = as substring and would pick an
# arm64/EUS variant that won't boot on x86.)
SPOT_FLAGS=(); [ "$SPOT" = "1" ] && SPOT_FLAGS=(--provisioning-model=SPOT --instance-termination-action=DELETE)
echo "▸ creating $SKU (${MESH_GPU}) in $ZONE — image-family $IMG_FAMILY ($IMG_PROJECT)"
gcloud compute instances create "$NAME" --project "$PROJECT" --zone "$ZONE" \
  --machine-type "$SKU" --maintenance-policy TERMINATE \
  --image-family "$IMG_FAMILY" --image-project "$IMG_PROJECT" \
  --boot-disk-size 100GB --tags noetica-proof \
  --metadata mesh-model="$MODEL" \
  --metadata-from-file startup-script="$HERE/cloud-init.sh" \
  "${ACCEL_FLAGS[@]}" "${SPOT_FLAGS[@]}" >/dev/null \
  || die "instance create failed (check $MESH_GPU quota in $ZONE)"

IP="$(gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$PROJECT" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
[ -n "$IP" ] || die "no external IP on $NAME"
export MESH_URL="http://${IP}:11434/v1" MESH_MODEL="$MODEL"
echo "▸ node up at ${IP} — waiting for the mesh to serve ${MODEL} (driver + ollama + pull ~3-6 min)"

# ── 3. Poll until the model is loadable ──────────────────────────────────────
ready=0
for _ in $(seq 1 90); do
  if curl -sf -m5 "$MESH_URL/models" 2>/dev/null | grep -q "${MODEL%%:*}"; then ready=1; break; fi
  sleep 10
done
[ "$ready" = "1" ] || die "mesh did not become ready at $MESH_URL (check the node's startup-script log)"
echo "✓ mesh ready at $MESH_URL"

# ── 4. Prove — head-to-head vs the frontier, writes the client artifact ──────
"$HERE/client-proof.sh" "$N"
echo "✓ proof complete — teardown follows automatically"
