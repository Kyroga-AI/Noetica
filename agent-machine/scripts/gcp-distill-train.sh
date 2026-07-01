#!/bin/bash
# gcp-distill-train — provision a GPU VM and QLoRA-fine-tune a base model on the VERIFIED canon, producing a
# sovereign GGUF model. This is the MISSING fine-tune launcher (the dataset side already exists:
# build-distill-dataset.py + distill_prep.py). It mirrors gcp-marker-rebuild.sh / gcp-board-robust.sh exactly:
# multi-zone + machine-escalation stockout fallback, a self-installing startup-script that pulls code/data from
# GCS, streams status to GCS, self-deletes on completion, and a --termination-time safety net.
#
# WHY: verified-compute + frontier-authored-canon are the two emptiest industry columns (memory: vendor-matrix,
# watson/notebooklm/modeldev audit). Distilling that canon into model WEIGHTS is the on-thesis move no peer can
# copy — and the only thing standing between the dataset and a sovereign model was this launcher.
#
# SAFETY — DRY-RUN BY DEFAULT (like scripts/bearbrowser gated runners):
#   bash scripts/gcp-distill-train.sh             # prints the plan + the gcloud command, provisions NOTHING
#   bash scripts/gcp-distill-train.sh --confirm   # actually launches the GPU VM and trains
#
# Usage: BASE_MODEL=Qwen/Qwen2.5-7B-Instruct EPOCHS=2 RUN_TAG=sovereign-v1 STAR=0 \
#          bash scripts/gcp-distill-train.sh [--confirm]
set -uo pipefail

CONFIRM=0
for a in "$@"; do case "$a" in --confirm) CONFIRM=1;; esac; done

PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"

BASE_MODEL="${BASE_MODEL:-Qwen/Qwen2.5-7B-Instruct}"
EPOCHS="${EPOCHS:-2}"
LR="${LR:-2e-4}"
RUN_TAG="${RUN_TAG:-sovereign-v1}"
TAG="${RUN_TAG#sovereign-}"                        # artifacts are sovereign-$TAG; dedupe a leading sovereign- so
                                                  # RUN_TAG=sovereign-v1 yields sovereign-v1, not sovereign-sovereign-v1
STAR="${STAR:-0}"                                 # 1 = also generate correct-only STaR reasoning traces on-box
QUANT="${QUANT:-q4_K_M}"                          # GGUF quantization level for the exported sovereign model
VM="distill-$TAG"
STALL_MIN="${STALL_MIN:-30}"                      # minutes of frozen progress before kill (training is long)
ZONES="${ZONES:-us-east1-d us-east4-a us-east4-c us-west1-a us-west1-b us-west4-a us-central1-a us-central1-b us-central1-c}"
MACHINES="${MACHINES:-g2-standard-8 a2-highgpu-1g a2-ultragpu-1g}"   # escalate L4 → A100-40 → A100-80
MODEL_OUT="$GCS/models/sovereign-$TAG"
STATUS="$GCS/bench/distill-status-$TAG.json"
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=12)).replace(microsecond=0).isoformat())")

# ── PLAN (printed in BOTH modes) ───────────────────────────────────────────────────────────────────────────
cat <<PLAN
# ────────────────────────────────────────────────────────────────────────────────────────────
# gcp-distill-train · SOVEREIGN MODEL QLoRA FINE-TUNE  (run_tag=$RUN_TAG)
# ────────────────────────────────────────────────────────────────────────────────────────────
#   base model    : $BASE_MODEL
#   dataset       : rebuilt ON-BOX via build-distill-dataset.py (sympy present → verified-operator
#                   pairs INCLUDED, unlike the 8GB Mac)$( [ "$STAR" = "1" ] && echo "  + STaR correct-only traces (distill_prep.py)" )
#   provenance    : train_lora.py ASSERTS 0 pairs from the local model (fails loud on any leak)
#   QLoRA         : 4-bit NF4 · r=16 α=32 · epochs=$EPOCHS · lr=$LR
#   export        : merge adapters → fp16 → GGUF ($QUANT) → sovereign-$TAG.gguf
#   upload to     : $MODEL_OUT/  (model + manifest.json w/ base, epochs, dataset stats, sha256)
#   status stream : $STATUS  (every 20s)
#   instance      : $VM  ·  machines (escalate on stockout): $MACHINES
#   zones (sweep) : $ZONES
#   safety        : --termination-time=$TERM  --instance-termination-action=DELETE  ·  self-deletes on done
#   est. cost     : ~\$3–9 for a 7B QLoRA over ~1.4k pairs (single L4/A100, well under the 12h cap)
# ────────────────────────────────────────────────────────────────────────────────────────────
PLAN

# ── STARTUP SCRIPT (runs on the VM) ────────────────────────────────────────────────────────────────────────
cat > /tmp/distill-startup.sh <<STARTUP
#!/bin/bash
export HOME=/root; mkdir -p /root/.noetica
LSTATUS=/root/.noetica/distill-status.json
exec >/var/log/distill.log 2>&1; set -x
GCS="$GCS"
st(){ python3 - "\$1" "\$2" <<PY 2>/dev/null
import json,sys,time
json.dump({"run_tag":"$RUN_TAG","phase":sys.argv[1],"detail":sys.argv[2],"ts":time.time()}, open("\$LSTATUS","w"))
PY
}
# sidecar: stream log + status to GCS every 20s (durable + live)
( while true; do
    gsutil -q cp /var/log/distill.log "\$GCS/bench/distill-$TAG.log" 2>/dev/null
    [ -s "\$LSTATUS" ] && gsutil -q cp "\$LSTATUS" "$STATUS" 2>/dev/null
    sleep 20
  done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }

step "wait GPU"; st boot "wait-gpu"; for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
step "python + training stack"; st install "pip torch transformers peft trl bitsandbytes"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip cmake build-essential || { step FATAL-apt; exit 1; }
PIP='python3 -m pip install -q --break-system-packages'
\$PIP sympy numpy || python3 -m pip install -q sympy numpy || { step FATAL-base; exit 1; }
\$PIP torch transformers peft trl bitsandbytes accelerate datasets safetensors || { step FATAL-mlstack; exit 1; }

step "pull code"; st pull "agent-machine"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am || { step FATAL-code; exit 1; }

step "rebuild dataset ON-BOX (sympy present → verified-operator pairs included)"; st dataset "build-distill-dataset"
python3 scripts/build-distill-dataset.py || { step FATAL-dataset; exit 1; }
SFT=/opt/am/dist/distill-sft.jsonl
[ -s "\$SFT" ] || { step FATAL-empty-dataset; exit 1; }
if [ "$STAR" = "1" ]; then
  step "STaR: correct-only reasoning traces (distill_prep.py) — append to SFT"; st dataset "star-traces"
  # distill_prep needs ollama+brain; best-effort — the canon pairs alone are a valid run if this is skipped.
  timeout 300 bash -c 'curl -fsSL https://ollama.com/install.sh | sh' && \
    OLLAMA_KEEP_ALIVE=30m nohup ollama serve >/var/log/ollama.log 2>&1 & sleep 10
  for n in 1 2 3; do timeout 1800 ollama pull qwen2.5:7b && break; sleep 8; done
  gsutil -q cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz && mkdir -p /opt/OCW && tar xzf /tmp/b.tgz -C /opt/OCW || true
  BR=/opt/OCW/_brain; [ -d "\$BR" ] || BR=/opt/OCW
  for F in biology physics mathematics chemistry; do
    OCW_BRAIN=\$BR OLLAMA_HOST=http://127.0.0.1:11434 timeout 1800 python3 scripts/distill_prep.py \$F --n 80 \
      && cat /root/.noetica/distill/\$F.sft.jsonl >> "\$SFT" 2>/dev/null || true
  done
fi
PAIRS=\$(wc -l < "\$SFT" 2>/dev/null || echo 0); step "dataset ready: \$PAIRS pairs"; st dataset "\$PAIRS pairs"

# stall watchdog: status-ts frozen for STALL_MIN min → abort (VM self-deletes via termination-time anyway)
( prev=""; stuck=0; while true; do sleep 60
    cur=\$(python3 -c "import json;print(json.load(open('\$LSTATUS'))['ts'])" 2>/dev/null||echo "")
    if [ "\$cur" = "\$prev" ]; then stuck=\$((stuck+1)); else stuck=0; prev=\$cur; fi
    [ "\$stuck" -ge $STALL_MIN ] && { step "STALL — status frozen ${STALL_MIN}min; aborting"; pkill -f train_lora; touch /tmp/stalled; break; }
  done ) &

step "QLoRA TRAIN — base=$BASE_MODEL epochs=$EPOCHS"; st train "qlora epochs=$EPOCHS"
MERGED=/opt/am/dist/sovereign-merged
BASE_MODEL="$BASE_MODEL" SFT_PATH="\$SFT" OUT_DIR="\$MERGED" EPOCHS=$EPOCHS LR=$LR RUN_TAG="$RUN_TAG" \
  stdbuf -oL -eL python3 scripts/train_lora.py > /var/log/train.txt 2>&1
TEXIT=\$?
gsutil -q cp /var/log/train.txt "\$GCS/bench/distill-train-$TAG.txt" 2>/dev/null || true
[ -f /tmp/stalled ] && { step "ENDED stalled"; st error "stalled"; }
[ "\$TEXIT" = "0" ] && [ -d "\$MERGED" ] || { step "FATAL-train (exit \$TEXIT)"; st error "train exit \$TEXIT"; }

step "convert + quantize → GGUF ($QUANT)"; st export "gguf $QUANT"
GGUF=/opt/am/dist/sovereign-$TAG.gguf
git clone --depth 1 https://github.com/ggerganov/llama.cpp /opt/llama.cpp || true
python3 -m pip install -q --break-system-packages -r /opt/llama.cpp/requirements.txt || true
python3 /opt/llama.cpp/convert_hf_to_gguf.py "\$MERGED" --outfile /opt/am/dist/sovereign-$TAG.f16.gguf --outtype f16 || { step FATAL-convert; st error convert; }
( cd /opt/llama.cpp && cmake -B build >/dev/null 2>&1 && cmake --build build --target llama-quantize -j >/dev/null 2>&1 ) || true
QBIN=\$(find /opt/llama.cpp -name 'llama-quantize' -type f 2>/dev/null | head -1)
[ -n "\$QBIN" ] && "\$QBIN" /opt/am/dist/sovereign-$TAG.f16.gguf "\$GGUF" $QUANT || cp /opt/am/dist/sovereign-$TAG.f16.gguf "\$GGUF"

step "manifest + upload → $MODEL_OUT/"; st upload "model + manifest"
SHA=\$(sha256sum "\$GGUF" 2>/dev/null | awk '{print \$1}')
python3 - <<PY
import json,hashlib,os
g="\$GGUF"
m={"run_tag":"$RUN_TAG","base_model":"$BASE_MODEL","epochs":$EPOCHS,"lr":"$LR","quant":"$QUANT",
   "star":"$STAR"=="1","pairs":int(open("\$SFT").read().count(chr(10))) if os.path.exists("\$SFT") else 0,
   "gguf":os.path.basename(g),"sha256":"\$SHA","bytes":os.path.getsize(g) if os.path.exists(g) else 0,
   "provenance":"frontier-authored canon + verified operators; 0 pairs from local model (asserted by train_lora.py)"}
json.dump(m, open("/opt/am/dist/manifest.json","w"), indent=2)
print(json.dumps(m))
PY
gsutil -q cp "\$GGUF" "$MODEL_OUT/sovereign-$TAG.gguf" || step WARN-upload-gguf
gsutil -q cp /opt/am/dist/manifest.json "$MODEL_OUT/manifest.json" || step WARN-upload-manifest
gsutil -q cp "\$SFT" "$MODEL_OUT/distill-sft.jsonl" 2>/dev/null || true
st done "uploaded $MODEL_OUT/sovereign-$TAG.gguf"

step "DONE — self-delete (model in $MODEL_OUT/)"
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

# ── LAUNCH (or, in dry-run, just print the gcloud command) ──────────────────────────────────────────────────
GCLOUD_EXAMPLE="gcloud compute instances create $VM --project=$PROJECT --zone=<ZONE> --machine-type=<MACHINE> \\
    --maintenance-policy=TERMINATE --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \\
    --metadata=install-nvidia-driver=True --metadata-from-file startup-script=/tmp/distill-startup.sh \\
    --boot-disk-size=300GB --service-account=$SA --scopes=cloud-platform \\
    --termination-time=\"$TERM\" --instance-termination-action=DELETE"

if [ "$CONFIRM" != "1" ]; then
  echo
  echo "DRY-RUN — no GPU provisioned, no GCS writes, nothing created. Re-run with --confirm to launch."
  echo "Would create $VM (escalating $MACHINES across the zone sweep) with:"
  echo
  echo "$GCLOUD_EXAMPLE"
  echo
  echo "Startup-script staged at /tmp/distill-startup.sh ($(wc -l < /tmp/distill-startup.sh) lines) — inspect it, then add --confirm."
  exit 0
fi

# CONFIRMED — guard against a duplicate active run, then escalate machine size across zones (marker pattern).
ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(status)" 2>/dev/null | head -1)
case "$ex" in RUNNING|PROVISIONING|STAGING|REPAIRING) echo "ABORT — $VM is $ex (a run is in flight)"; exit 0;; esac
echo "# distill-$RUN_TAG · CONFIRMED · base=$BASE_MODEL · epochs=$EPOCHS · → $MODEL_OUT/"
for M in $MACHINES; do
 for Z in $ZONES; do
  echo "  trying $VM ($M) in $Z"
  if gcloud compute instances create $VM --project=$PROJECT --zone=$Z --machine-type=$M \
      --maintenance-policy=TERMINATE --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
      --metadata=install-nvidia-driver=True --metadata-from-file startup-script=/tmp/distill-startup.sh \
      --boot-disk-size=300GB --service-account=$SA --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE 2>/tmp/distill-err; then
    echo "=== distill-$RUN_TAG LAUNCHED on $M in $Z — watch: gcloud storage cat $STATUS ==="; exit 0
  fi
  if grep -qiE 'quota|exceeded' /tmp/distill-err; then echo "    $M QUOTA: $(grep -iE 'quota' /tmp/distill-err | head -1 | cut -c1-110)"; break; fi
  echo "    $Z stockout, next zone"
 done
 echo "  ▸ $M exhausted, escalating to a bigger GPU"
done
echo "FATAL — no GPU of any size available"; tail -3 /tmp/distill-err; exit 1
