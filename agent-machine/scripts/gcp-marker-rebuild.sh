#!/bin/bash
# gcp-marker-rebuild — de-mangle the golden corpus at the source, as BULLETPROOF as the board. Marker
# (math-aware PDF->LaTeX) rebuilds the 2D structure pymupdf flattened, writing {pdf}.marker.md sidecars that
# build-corpus prefers when re-vectorizing -> brain-v5.
#
# RESILIENCE (matches gcp-board-cpu.sh):
#   • INCREMENTAL output — every sidecar is uploaded to GCS the instant it's written (marker-extract.py), so a
#     VM death loses nothing; the sidecars accumulate in $GCS/marker-sidecars/.
#   • RESUME — a GCS manifest of ATTEMPTED files; on (re)launch we pull it and skip them (incl. failed/timed-out
#     ones, so no poison-PDF loop), with a per-PDF hard timeout so one bad PDF can't freeze the run.
#   • AUTO-RESUME LOOP on the VM — run -> on stall/crash resume from the manifest -> repeat until done==total.
#   • SURVIVES VM DEATH — relaunch (same names) resumes from the GCS manifest. Self-deletes only when complete.
#
# Usage:  bash scripts/gcp-marker-rebuild.sh            # full resilient de-mangle of the gold corpus
#         MARKER_LIMIT=80 bash scripts/gcp-marker-rebuild.sh   # cap NEW sidecars per attempt (chunked)
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
VM="marker-rebuild"
MARKER_LIMIT="${MARKER_LIMIT:-0}"                 # 0 = all gold PDFs (the loop resumes across crashes)
PDF_TIMEOUT="${MARKER_PDF_TIMEOUT:-300}"
STALL_MIN="${STALL_MIN:-20}"                      # minutes of frozen progress before kill -> resume
DEPTS="${DEPTS:-8,18,5,7,6}"                      # STEM gold first (physics, math, chem, bio, eecs)
SIDECARS="$GCS/marker-sidecars"
MANIFEST="$GCS/bench/marker-done.txt"; STATUS="$GCS/bench/marker-status.json"
ZONES="${ZONES:-us-east1-d us-east4-a us-east4-c us-west1-a us-west1-b us-west4-a us-central1-a us-central1-c}"
MACHINES="${MACHINES:-g2-standard-8 a2-highgpu-1g a2-ultragpu-1g}"   # escalate L4 -> A100-40 -> A100-80
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=12)).replace(microsecond=0).isoformat())")

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(name)" 2>/dev/null)
[ -n "$ex" ] && { echo "ABORT — $VM already running (it auto-resumes itself; nothing to do)"; exit 0; }
echo "# marker-rebuild · resilient · limit=${MARKER_LIMIT:-all} · pdf-timeout=${PDF_TIMEOUT}s · depts=$DEPTS · auto-resume → done==total"

cat > /tmp/marker-startup.sh <<STARTUP
#!/bin/bash
export HOME=/root; mkdir -p /root/.marker
LMANIFEST=/root/.marker/done.txt; LSTATUS=/root/.marker/status.json
exec >/var/log/marker.log 2>&1; set -x
GCS="$GCS"
( while true; do
    gsutil -q cp /var/log/marker.log "\$GCS/marker-rebuild.log" 2>/dev/null
    [ -s "\$LMANIFEST" ] && gsutil -q cp "\$LMANIFEST" "$MANIFEST" 2>/dev/null
    [ -s "\$LSTATUS" ]   && gsutil -q cp "\$LSTATUS"   "$STATUS"   2>/dev/null
    sleep 20
  done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }
step "wait GPU"; for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
step "python + marker-pdf (neural PDF->LaTeX)"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step FATAL-apt; exit 1; }
python3 -m pip install -q --break-system-packages marker-pdf || python3 -m pip install -q marker-pdf || { step FATAL-marker; exit 1; }
step "pull code + corpus (STEM depts $DEPTS)"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am || { step FATAL-code; exit 1; }
mkdir -p /opt/corpus && timeout 1800 gsutil -m rsync -r -x '.*\.(jpg|png|json)\$' "\$GCS/corpus" /opt/corpus 2>/dev/null || true
step "RESUME — pull the done-manifest (skip already-attempted PDFs across VM deaths)"
gsutil -q cp "$MANIFEST" "\$LMANIFEST" 2>/dev/null && step "resumed (\$(wc -l < \$LMANIFEST 2>/dev/null||echo 0) PDFs already attempted)" || step "fresh run"

# ── AUTO-RESUME LOOP: run → on stall/crash resume from the manifest → repeat until complete ────────────────
ATTEMPT=0
while true; do
  ATTEMPT=\$((ATTEMPT+1)); rm -f /tmp/stalled; step "marker attempt \$ATTEMPT"
  ( prev=-1; stuck=0; while true; do sleep 60
      cur=\$(python3 -c "import json;print(json.load(open('\$LSTATUS'))['done'])" 2>/dev/null||echo -1)
      if [ "\$cur" = "\$prev" ]; then stuck=\$((stuck+1)); else stuck=0; prev=\$cur; fi
      [ "\$stuck" -ge $STALL_MIN ] && { step "STALL — done=\$cur frozen ${STALL_MIN}min; killing → will resume"; pkill -f marker-extract; touch /tmp/stalled; break; }
    done ) & WD=\$!
  MARKER_CORPUS=/opt/corpus MARKER_ALL=0 MARKER_LIMIT=$MARKER_LIMIT MARKER_PDF_TIMEOUT=$PDF_TIMEOUT \
    MARKER_SIDECAR_GCS="$SIDECARS" MARKER_DONE_MANIFEST=\$LMANIFEST MARKER_STATUS=\$LSTATUS \
    stdbuf -oL -eL python3 scripts/marker-extract.py
  EXIT=\$?; kill \$WD 2>/dev/null
  gsutil -q cp "\$LMANIFEST" "$MANIFEST" 2>/dev/null; gsutil -q cp "\$LSTATUS" "$STATUS" 2>/dev/null
  REMAIN=\$(python3 -c "import json;print(json.load(open('\$LSTATUS')).get('remaining',1))" 2>/dev/null||echo 1)
  if [ ! -f /tmp/stalled ] && [ "\$EXIT" = "0" ] && [ "\$REMAIN" = "0" ]; then step "COMPLETE — all gold PDFs de-mangled ✓"; break; fi
  [ "\$ATTEMPT" -ge 40 ] && { step "gave up after 40 attempts"; break; }
  step "incomplete (stall=\$([ -f /tmp/stalled ] && echo yes||echo no) exit=\$EXIT remaining=\$REMAIN) — resuming in 10s"; sleep 10
done

step "DONE — self-delete (sidecars are already in $SIDECARS/, manifest in $MANIFEST)"
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

# escalate GPU size if the small ones are stocked out: L4 → A100-40 → A100-80 (skip a type on QUOTA, sweep
# zones on STOCKOUT). Single GPU is plenty for Marker inference; bigger = faster de-mangle.
for M in $MACHINES; do
 for Z in $ZONES; do
  echo "  trying $VM ($M) in $Z"
  if gcloud compute instances create $VM --project=$PROJECT --zone=$Z --machine-type=$M \
      --maintenance-policy=TERMINATE --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
      --metadata=install-nvidia-driver=True --metadata-from-file startup-script=/tmp/marker-startup.sh \
      --boot-disk-size=200GB --service-account=$SA --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE 2>/tmp/mk-err; then
    echo "=== marker-rebuild LAUNCHED on $M in $Z — watch: gcloud storage cat $STATUS ==="; exit 0
  fi
  if grep -qiE 'quota|exceeded' /tmp/mk-err; then echo "    $M QUOTA: $(grep -iE 'quota' /tmp/mk-err | head -1 | cut -c1-110)"; break; fi
  echo "    $Z stockout, next zone"
 done
 echo "  ▸ $M exhausted, escalating to a bigger GPU"
done
echo "FATAL — no GPU of any size available"; tail -3 /tmp/mk-err; exit 1
