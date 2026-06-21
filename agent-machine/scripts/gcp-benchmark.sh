#!/bin/bash
# gcp-benchmark — run the full MMLU benchmark suite on the cloud (fast 3B), push the scoreboard.
#
# Autonomous startup-script (same pattern as gcp-vectorize.sh): pulls code + the COMPLETE brain
# + the MMLU bank from GCS, installs ollama + the answer model, runs baseline-vs-brain across all
# 14 subjects + the verified-compute arm + the domain router, pushes results to GCS, self-deletes.
# HARD SHUTDOWN guard. Cost ~$2-4 (a 3B over 2,328 Q on 32 vCPU is fast).
#
# PREREQ: a COMPLETE brain at $GCS/brain-complete.tar.gz (math + all domains). Assemble it by
# merging the laptop's math brain with the cloud vectorize output, then:
#   tar czf brain-complete.tar.gz -C ~/Downloads/"MIT OCW" _brain
#   gsutil cp brain-complete.tar.gz gs://sourceos-artifacts-socioprophet/ocw-corpus/
set -euo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"; ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-ocw-benchmark}"; MACHINE="${MACHINE:-n2-standard-32}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
MODEL="${MMLU_MODEL:-llama3.2:3b}"; PER="${MMLU_PER_SUBJECT:-25}"
TERM_TIME="${TERM_TIME:-$(python3 -c "import datetime;print(datetime.datetime.now().astimezone().replace(hour=23,minute=59,second=0,microsecond=0).isoformat())")}"

cat > /tmp/ocw-bench-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/ocw-bench.log 2>&1; set -x
GCS="$GCS"; MODEL="$MODEL"; PER="$PER"
( while true; do gsutil -q cp /var/log/ocw-bench.log "\$GCS/bench/run.log" 2>/dev/null; sleep 45; done ) &
step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; gsutil -q cp /var/log/ocw-bench.log "\$GCS/bench/run.log" 2>/dev/null||true; }

step "install ollama + models (\$MODEL + nomic)"
curl -fsSL https://ollama.com/install.sh | sh
(ollama serve >/var/log/ollama.log 2>&1 &); sleep 12
ollama pull nomic-embed-text; ollama pull "\$MODEL"

step "install node + python deps"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs python3-pip
pip3 install --break-system-packages pypdf scikit-learn numpy scipy sympy

step "pull code + complete brain + bank"
mkdir -p /opt/am && gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && npm ci
mkdir -p /root/MITOCW && gsutil cp "\$GCS/brain-complete.tar.gz" /tmp/b.tgz && tar xzf /tmp/b.tgz -C /root/MITOCW
mkdir -p /root/.noetica/corpus/benchmarks && gsutil cp "\$GCS/bench/mmlu_stem.json" /root/.noetica/corpus/benchmarks/ && gsutil cp "\$GCS/bench/gsm8k_test.jsonl" /root/.noetica/corpus/benchmarks/ 2>/dev/null||true

step "BENCHMARK 1/3 — baseline vs brain-retrieval, all 14 subjects"
OLLAMA_HOST=http://127.0.0.1:11434 OCW_BRAIN=/root/MITOCW/_brain MMLU_MODEL="\$MODEL" \
  MMLU_PER_SUBJECT="\$PER" npx tsx scripts/mmlu-brain-bench.ts > /var/log/bench-brain.log 2>&1 || echo "brain-bench EXIT \$?"
gsutil cp /var/log/bench-brain.log "\$GCS/bench/result-brain-vs-baseline.log"

step "BENCHMARK 2/3 — verified-compute arm (physics+math)"
OLLAMA_HOST=http://127.0.0.1:11434 MMLU_SUBJECTS=college_physics,high_school_physics,college_mathematics,high_school_mathematics \
  MMLU_PER_SUBJECT="\$PER" python3 scripts/compute_arm.py > /var/log/bench-compute.log 2>&1 || echo "compute EXIT \$?"
gsutil cp /var/log/bench-compute.log "\$GCS/bench/result-compute-arm.log"

step "BENCHMARK 3/3 — domain router (all subjects)"
OCW_CORPUS=/root/MITOCW/_corpus python3 scripts/domain_softmax.py > /var/log/bench-router.log 2>&1 || echo "router EXIT \$?"
gsutil cp /var/log/bench-router.log "\$GCS/bench/result-router.log"

step "DONE — results pushed to \$GCS/bench/ ; self-deleting"
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE) — benchmark suite, HARD SHUTDOWN at $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=120GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE \
  --metadata-from-file startup-script=/tmp/ocw-bench-startup.sh
echo "# launched — watch: gsutil cat $GCS/bench/run.log ; results land in $GCS/bench/result-*.log"
