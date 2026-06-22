#!/bin/bash
# gcp-vectorize — vectorize the MMLU-domain brain on a cloud box, AUTONOMOUSLY.
#
# The VM runs a startup-script (no SSH, no inbound firewall needed): it pulls code + corpus
# from GCS, vectorizes, pushes brain.tar.gz, streams its log to GCS so it's watchable, and
# self-deletes. HARD SHUTDOWN guaranteed by GCP (--termination-time) as a backstop. The local
# command returns immediately — your terminal is free. Cost ~$5-8, capped by the 6pm guard.
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-ocw-vectorize}"
MACHINE="${MACHINE:-n2-standard-32}"  # c2d pool was exhausted in us-central1-a; n2 is broadly available
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
DEPTS="${OCW_DEPTS:-5,8,7,20,6}"   # pending MMLU domains (laptop already has math); merges in
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print(datetime.datetime.now().astimezone().replace(hour=18,minute=0,second=0,microsecond=0).isoformat())")}"

# ── the autonomous startup-script the VM runs at boot (self-contained, no SSH) ──
cat > /tmp/ocw-vm-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/ocw-run.log 2>&1; set -x
export HOME=/root   # GCE startup scripts run with NO \$HOME → 'ollama pull' panics (envconfig.Models),
                    # the embed model never installs, every embed returns [] → 0 vectors → 0 courses.
GCS="$GCS"; DEPTS="$DEPTS"
# ship the log to GCS every 45s so it's watchable from anywhere
( while true; do gsutil -q cp /var/log/ocw-run.log "\$GCS/vm-run.log" 2>/dev/null; sleep 45; done ) &
LOGPID=\$!
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/ocw-run.log "\$GCS/vm-run.log" 2>/dev/null||true; }

step "install ollama"
curl -fsSL https://ollama.com/install.sh | sh
systemctl restart ollama 2>/dev/null || (ollama serve >/var/log/ollama.log 2>&1 &)
sleep 12
for n in 1 2 3 4 5; do ollama pull nomic-embed-text && break; echo "embed-pull retry \$n"; sleep 8; done
ollama list | grep -q nomic-embed-text || { echo "FATAL: embed model missing after retries — aborting (would yield 0 vectors)"; exit 1; }

step "install node + python(pypdf) for PDF extraction"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git python3-pip
pip3 install --break-system-packages pypdf || pip3 install pypdf

step "pull code + corpus from GCS"
mkdir -p /opt/am && gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && npm ci
mkdir -p /opt/OCW/_corpus && gsutil -m rsync -r "\$GCS/_corpus" /opt/OCW/_corpus

step "vectorize depts \$DEPTS at conc=16"
OLLAMA_HOST=http://127.0.0.1:11434 OCW_CORPUS=/opt/OCW/_corpus OCW_BRAIN=/opt/OCW/_brain \
  OCW_DEPTS="\$DEPTS" BRAIN_CONCURRENCY=16 npx tsx scripts/build-corpus.ts || echo "VECTORIZE EXITED \$?"

step "push brain.tar.gz"
tar czf /opt/brain.tar.gz -C /opt/OCW _brain && gsutil cp /opt/brain.tar.gz "\$GCS/brain.tar.gz"

step "DONE — self-deleting"
kill \$LOGPID 2>/dev/null||true; gsutil -q cp /var/log/ocw-run.log "\$GCS/vm-run.log"||true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE) — autonomous startup-script, HARD SHUTDOWN at $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=200GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE \
  --metadata-from-file startup-script=/tmp/ocw-vm-startup.sh

echo "# launched — runs on its own (no SSH). watch:  gsutil cat $GCS/vm-run.log"
echo "# brain lands at $GCS/brain.tar.gz ; VM self-deletes on completion or at 6pm"
