#!/bin/bash
# gcp-concept-job — Track B: GPU concept extraction → canonical GLOSSARY per field, over the whole
# brain. GLiNER flies on an L4 (the laptop timed out at course 5/21). Autonomous startup script:
# installs the NLP stack (torch+gliner+spacy+nltk+keybert), pulls code+brain, runs glossary_build
# for every field, pushes <field>.glossary.json to GCS, self-deletes. HARD-SHUTDOWN guard.
#
# Separate VM name (concept-job) + output paths → runs alongside the board run (champ-eval) safely.
# Usage:  GCP_PROJECT=socioprophet-platform bash scripts/gcp-concept-job.sh
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-concept-job}"
MACHINE="${MACHINE:-g2-standard-8}"
ACCEL="${ACCEL:-}"          # set e.g. nvidia-tesla-t4 with MACHINE=n1-standard-8 when L4 is stocked out
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
PER_COURSE="${PER_COURSE:-800}"
FIELDS="${FIELDS:-biology chemistry physics mathematics eecs biological_eng earth_planetary}"
# Backstop hard-delete (the startup self-delete fails when the SA lacks compute.instances.delete →
# the VM zombies until this fires). Capped at +1h (the glossary job finishes in ~25min). REAL FIX:
# grant the SA roles/compute.instanceAdmin.v1 so the on-done self-delete works promptly.
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=1)).replace(microsecond=0).isoformat())")}"

cat > /tmp/concept-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/concept-run.log 2>&1; set -x
export HOME=/root
GCS="$GCS"
( while true; do gsutil -q cp /var/log/concept-run.log "\$GCS/concept-run.log" 2>/dev/null; sleep 30; done ) & LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/concept-run.log "\$GCS/concept-run.log" 2>/dev/null||true; }

step "wait for NVIDIA driver"
for i in \$(seq 1 60); do nvidia-smi >/dev/null 2>&1 && break; sleep 10; done
nvidia-smi || echo "WARN: no GPU (GLiNER will run on CPU, slow)"

step "install python + NLP stack (torch+gliner+spacy+nltk+keybert)"
apt-get update -y && apt-get install -y python3-pip
# CRITICAL: install into the SAME interpreter that runs the script (DLVM has conda+system python;
# bare pip3 last time installed numpy to the wrong one → ModuleNotFoundError on every field).
PY=\$(which python3)
timeout 1200 \$PY -m pip install -q nltk spacy gliner keybert numpy scikit-learn scipy \
  || timeout 1200 \$PY -m pip install --break-system-packages -q nltk spacy gliner keybert numpy scikit-learn scipy || { step "FATAL: pip install (timeout/fail)"; exit 1; }
\$PY -c "import numpy, sklearn, gliner, nltk, spacy; print('DEPS OK on', __import__('sys').executable)" || { step "FATAL: deps not importable by \$PY"; exit 1; }
\$PY -c "import nltk; [nltk.download(d,quiet=True) for d in ('punkt','punkt_tab','averaged_perceptron_tagger','averaged_perceptron_tagger_eng','wordnet')]"
timeout 300 \$PY -m spacy download en_core_web_sm || step "WARN: spacy model dl failed (NLTK+GLiNER still work)"
\$PY -c "import torch;print('CUDA:',torch.cuda.is_available())"

step "pull code + brain"
mkdir -p /opt/am/scripts && timeout 120 gsutil -m cp "\$GCS/code/agent-machine/scripts/concept_extract.py" "\$GCS/code/agent-machine/scripts/glossary_build.py" /opt/am/scripts/ || { step "FATAL: code pull"; exit 1; }
mkdir -p /opt/OCW && timeout 900 gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz || { step "FATAL: brain pull"; exit 1; }
tar xzf /tmp/b.tgz -C /opt/OCW || { step "FATAL: brain extract"; exit 1; }
step "SETUP COMPLETE ✓ — extracting glossaries"

step "extract glossaries (GPU GLiNER) — fields: $FIELDS"
cd /opt/am
for F in $FIELDS; do
  step "field \$F"
  OCW_BRAIN=/opt/OCW/_brain \$PY scripts/glossary_build.py \$F --per-course $PER_COURSE --top 250 || step "FIELD \$F FAILED"
  gsutil cp /opt/OCW/_brain/\$F.glossary.json "\$GCS/glossary/\$F.glossary.json" 2>/dev/null || echo "no glossary for \$F"
done

step "DONE — self-deleting"
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/concept-run.log "\$GCS/concept-run.log"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

ACCELFLAG=""; [ -n "$ACCEL" ] && ACCELFLAG="--accelerator=type=$ACCEL,count=1"
echo "# creating $VM ($MACHINE ${ACCEL:-L4} GPU) — concept-extraction glossary job, HARD SHUTDOWN at $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --maintenance-policy=TERMINATE $ACCELFLAG \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --metadata="install-nvidia-driver=True" --metadata-from-file startup-script=/tmp/concept-startup.sh \
  --boot-disk-size=120GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE

echo "# launched. watch:  gsutil cat $GCS/concept-run.log   ·   glossaries → $GCS/glossary/<field>.glossary.json"
