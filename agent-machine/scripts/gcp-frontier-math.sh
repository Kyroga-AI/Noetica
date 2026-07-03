#!/usr/bin/env bash
# gcp-frontier-math — one command: spin up a GPU node, run the FRONTIER-MATH board (MATH-500,
# baseline vs verified-compute on the SAME model), compute the exact-McNemar significance, keep
# the artifact, tear the node down. No lingering spend.
#
# This REUSES the node lifecycle proven by scripts/gcp-prove-frontier.sh + scripts/cloud-init.sh
# (create → firewall-to-your-IP → poll → teardown-trap). It is NOT a duplicate of that runner:
# gcp-prove-frontier does a model-vs-model head-to-head (mesh vs live Claude/GPT); THIS drives the
# MATH-500 technique measurement (frontier-math-bench.ts) — the reproduced frontier fact that
# turns the intelligence-superiority benchmark from "cite the frontier" into "measured at it".
#
#   ./gcp-frontier-math.sh [n]        # n = number of MATH-500 problems (default 100; 0 = all 500)
#
# Preconditions (yours — this script holds no credentials):
#   gcloud auth login ; export GCP_PROJECT=<your-project>
#   a GPU quota in the zone (see MESH_GPU below). Local: python3 + npx tsx (the board runs on THIS
#   host and calls the remote node's OpenAI-compatible endpoint; the verified-compute arm executes
#   math_operators/eval_sympy/math_grade locally).
#
# Tunables: GCP_ZONE (us-central1-a), FMATH_MODEL (qwen2.5:7b — match the MMLU board), MESH_GPU
#   (l4|v100|t4|p100|a100; default v100), MESH_SKU, MESH_SPOT (1=Spot), FMATH_SEED (1729),
#   FMATH_BANK (skip the MATH-500 fetch and use your own [{id,problem,answer}] JSON).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${GCP_ZONE:-us-central1-a}"
NAME="${MESH_NODE:-noetica-frontier-math}"
MODEL="${FMATH_MODEL:-qwen2.5:7b}"
SPOT="${MESH_SPOT:-1}"
SEED="${FMATH_SEED:-1729}"
N="${1:-100}"
FW="${NAME}-ollama"
OUT="${FMATH_OUT:-$HERE/../dist/frontier-math}"
BANK="${FMATH_BANK:-}"

IMG_FAMILY="${MESH_IMAGE_FAMILY:-rhel-9}"
IMG_PROJECT="${MESH_IMAGE_PROJECT:-rhel-cloud}"

# GPU selection — same knobs as gcp-prove-frontier.sh (L4 bundles into g2; others attach to n1/a2).
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
command -v npx    >/dev/null 2>&1 || die "npx (node) not installed — the board runs on this host"
command -v python3 >/dev/null 2>&1 || die "python3 not installed — needed by the verified-compute arm + grader"
[ -n "$PROJECT" ] || die "no project — export GCP_PROJECT=<id> or: gcloud config set project <id>"
gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . \
  || die "no active gcloud auth — run: gcloud auth login"
[ -f "$HERE/cloud-init.sh" ] || die "missing $HERE/cloud-init.sh"
MYIP="$(curl -fsS -m10 ifconfig.me 2>/dev/null || true)"
[ -n "$MYIP" ] || die "could not determine this host's public IP (needed to firewall the node)"
mkdir -p "$OUT"

# ── MATH-500 bank (unless you supplied FMATH_BANK) — the REAL benchmark, not hand-authored ──────
if [ -z "$BANK" ]; then
  BANK="$OUT/math500.json"
  if [ ! -s "$BANK" ]; then
    echo "▸ fetching the MATH-500 test split (HuggingFaceH4/MATH-500)"
    RAW="$OUT/math500.raw.jsonl"
    curl -fsSL -o "$RAW" \
      "https://huggingface.co/datasets/HuggingFaceH4/MATH-500/resolve/main/test.jsonl" \
      || die "MATH-500 fetch failed — set FMATH_BANK=<your MATH-format JSON> and re-run"
    python3 - "$RAW" "$BANK" <<'PY' || die "MATH-500 transform failed"
import json, sys
raw, out = sys.argv[1], sys.argv[2]
rows = []
for i, line in enumerate(open(raw)):
    line = line.strip()
    if not line:
        continue
    d = json.loads(line)
    rows.append({
        "id": d.get("unique_id", i),
        "problem": d["problem"],
        "answer": d["answer"],
        "subject": d.get("subject", "all"),
        "level": d.get("level"),
    })
json.dump(rows, open(out, "w"))
print(f"  wrote {len(rows)} MATH-500 problems -> {out}", file=sys.stderr)
PY
  fi
fi
echo "▸ project=$PROJECT zone=$ZONE sku=$SKU model=$MODEL spot=$SPOT n=$N seed=$SEED"

# ── Teardown trap — fires on ANY exit so we never leave a GPU running ─────────
cleanup() {
  echo "▸ teardown"
  gcloud compute instances delete "$NAME" --zone "$ZONE" --project "$PROJECT" --quiet 2>/dev/null || true
  gcloud compute firewall-rules delete "$FW" --project "$PROJECT" --quiet 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 1. Firewall :11434 to this host only ─────────────────────────────────────
gcloud compute firewall-rules create "$FW" --project "$PROJECT" \
  --direction INGRESS --action ALLOW --rules tcp:11434 \
  --source-ranges "${MYIP}/32" --target-tags noetica-frontier-math >/dev/null \
  || die "firewall create failed"

# ── 2. Create the GPU node (cloud-init.sh installs driver + ollama + pulls the model) ─
SPOT_FLAGS=(); [ "$SPOT" = "1" ] && SPOT_FLAGS=(--provisioning-model=SPOT --instance-termination-action=DELETE)
echo "▸ creating $SKU (${MESH_GPU}) in $ZONE — image-family $IMG_FAMILY ($IMG_PROJECT)"
gcloud compute instances create "$NAME" --project "$PROJECT" --zone "$ZONE" \
  --machine-type "$SKU" --maintenance-policy TERMINATE \
  --image-family "$IMG_FAMILY" --image-project "$IMG_PROJECT" \
  --boot-disk-size 100GB --tags noetica-frontier-math \
  --metadata mesh-model="$MODEL" \
  --metadata-from-file startup-script="$HERE/cloud-init.sh" \
  "${ACCEL_FLAGS[@]}" "${SPOT_FLAGS[@]}" >/dev/null \
  || die "instance create failed (check $MESH_GPU quota in $ZONE)"

IP="$(gcloud compute instances describe "$NAME" --zone "$ZONE" --project "$PROJECT" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
[ -n "$IP" ] || die "no external IP on $NAME"
API_BASE="http://${IP}:11434"
echo "▸ node up at ${IP} — waiting for ${MODEL} (driver + ollama + pull ~3-6 min)"

# ── 3. Poll until the model is loadable ──────────────────────────────────────
ready=0
for _ in $(seq 1 90); do
  if curl -sf -m5 "$API_BASE/v1/models" 2>/dev/null | grep -q "${MODEL%%:*}"; then ready=1; break; fi
  sleep 10
done
[ "$ready" = "1" ] || die "node did not become ready at $API_BASE (check the startup-script log)"
echo "✓ node ready at $API_BASE"

# ── 4. Run the board LOCALLY against the node: baseline vs verified-compute ──
echo "▸ running frontier-math board (baseline,opcompute) — n=$N seed=$SEED"
FMATH_API_BASE="$API_BASE" FMATH_MODEL="$MODEL" FMATH_BANK="$BANK" \
  FMATH_ARMS="baseline,opcompute" FMATH_N="$N" FMATH_SEED="$SEED" FMATH_OUT="$OUT" \
  npx tsx "$HERE/frontier-math-bench.ts" 2>&1 | tee "$OUT/scoreboard-$SEED.txt"

# ── 5. Exact-McNemar significance via the existing analyzer ──────────────────
VERDICTS="$OUT/frontier-math-verdicts-$SEED.jsonl"
if [ -s "$VERDICTS" ]; then
  echo "▸ significance (exact McNemar, opcompute vs baseline):"
  python3 "$HERE/board-analysis.py" --ckpt "$VERDICTS" --compare opcompute baseline --baseline baseline \
    2>&1 | tee -a "$OUT/scoreboard-$SEED.txt"
fi
echo "✓ frontier-math board complete — artifact: $OUT/scoreboard-$SEED.txt  ·  teardown follows automatically"
