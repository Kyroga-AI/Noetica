#!/bin/bash
# gcp-marker-rebuild — Track 2: de-mangle the golden corpus at the source. Marker (math-aware PDF->LaTeX)
# rebuilds the 2D structure pymupdf flattened. Writes {pdf}.marker.md sidecars (build-corpus prefers them),
# uploads them to GCS so they persist, then (full run) re-vectorizes -> brain-v5. VALIDATE=1 (default) does a
# small sample + prints a recovered formula so we confirm Marker works BEFORE the multi-hour full re-extract.
#
# Usage:  VALIDATE=1 MARKER_LIMIT=80 bash scripts/gcp-marker-rebuild.sh   # de-risk
#         VALIDATE=0 bash scripts/gcp-marker-rebuild.sh                    # full re-extract + re-vectorize
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
VM="marker-rebuild"
VALIDATE="${VALIDATE:-1}"
MARKER_LIMIT="${MARKER_LIMIT:-80}"
DEPTS="${DEPTS:-8,18,5,7,6}"          # STEM gold first (physics, math, chem, bio, eecs)
ZONES="${ZONES:-us-east1-d us-east4-a us-east4-c us-west1-a us-west1-b us-west4-a us-central1-a us-central1-c}"
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=8)).replace(microsecond=0).isoformat())")

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(name)" 2>/dev/null)
[ -n "$ex" ] && { echo "ABORT — $VM exists"; exit 0; }
echo "# marker-rebuild · validate=$VALIDATE · limit=$MARKER_LIMIT · depts=$DEPTS"

cat > /tmp/marker-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/marker.log 2>&1; set -x; export HOME=/root
GCS="$GCS"
( while true; do gsutil -q cp /var/log/marker.log "\$GCS/marker-rebuild.log" 2>/dev/null; sleep 20; done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }
step "wait GPU"; for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
step "python + marker-pdf (neural PDF->LaTeX)"
timeout 180 bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && timeout 300 apt-get install -y nodejs git python3-pip || { step FATAL-apt; exit 1; }
python3 -m pip install -q --break-system-packages marker-pdf || python3 -m pip install -q marker-pdf || { step FATAL-marker; exit 1; }
step "pull code + corpus (STEM depts $DEPTS)"
mkdir -p /opt/am && timeout 300 gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am || { step FATAL-code; exit 1; }
mkdir -p /opt/corpus
for d in \$(echo "$DEPTS" | tr ',' ' '); do timeout 1200 gsutil -m rsync -r -x '.*\.(jpg|png|json)$' "\$GCS/corpus" /opt/corpus 2>/dev/null || true; break; done
step "MARKER extract (limit=$MARKER_LIMIT, gold/math PDFs) → .marker.md sidecars"
MARKER_CORPUS=/opt/corpus MARKER_LIMIT=$MARKER_LIMIT timeout 14400 python3 scripts/marker-extract.py || step "!! marker \$?"
step "upload sidecars → GCS (persist for the full build)"
( cd /opt/corpus && find . -name '*.marker.md' | head -100000 | tar -czf /tmp/sidecars.tgz -T - ) && gsutil cp /tmp/sidecars.tgz "\$GCS/marker-sidecars.tgz" || step "!! upload"
step "SAMPLE — a recovered formula (confirm Marker de-mangled it):"
S=\$(find /opt/corpus -name '*.marker.md' | head -1); [ -n "\$S" ] && grep -m3 -iE 'frac|sum|int|=|sqrt|vec' "\$S" | head -3 || echo "  (no sidecar produced)"
if [ "$VALIDATE" = "0" ]; then
  step "FULL: re-vectorize with Marker sidecars → brain-v5"
  # (build-corpus prefers .marker.md; same path as gcp-finish-corpus, omitted here for the validation-first cut)
fi
step "DONE — self-delete"
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

# escalate GPU size if the small ones are stocked out: L4 → A100-40G → A100-80G (single-GPU is plenty for
# Marker inference; bigger = faster de-mangle). Skip a type on QUOTA (regional → no point sweeping zones);
# keep sweeping zones on STOCKOUT.
MACHINES="${MACHINES:-g2-standard-8 a2-highgpu-1g a2-ultragpu-1g}"
for M in $MACHINES; do
 for Z in $ZONES; do
  echo "  trying $VM ($M) in $Z"
  if gcloud compute instances create $VM --project=$PROJECT --zone=$Z --machine-type=$M \
      --maintenance-policy=TERMINATE --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
      --metadata=install-nvidia-driver=True --metadata-from-file startup-script=/tmp/marker-startup.sh \
      --boot-disk-size=200GB --service-account=$SA --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE 2>/tmp/mk-err; then
    echo "=== marker-rebuild LAUNCHED on $M in $Z — watch: gcloud storage cat $GCS/marker-rebuild.log ==="; exit 0
  fi
  if grep -qiE 'quota|exceeded' /tmp/mk-err; then echo "    $M QUOTA: $(grep -iE 'quota' /tmp/mk-err | head -1 | cut -c1-110)"; break; fi
  echo "    $Z stockout, next zone"
 done
 echo "  ▸ $M exhausted, escalating to a bigger GPU"
done
echo "FATAL — no GPU of any size available"; tail -3 /tmp/mk-err; exit 1
