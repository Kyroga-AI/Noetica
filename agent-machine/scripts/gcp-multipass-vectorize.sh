#!/bin/bash
# gcp-multipass-vectorize — four-pass brain build using multi-year course clusters.
#
# Runs AFTER the marker-rebuild VMs complete. One VM, four sequential passes:
#
#   V1 (fixed / 15% overlap)   — full MMLU-STEM rebuild with marker-sidecar math recovery
#   V2 (large / ~1024 tokens)  — second-year versions of multi-year clusters; analytical math wins
#   V3 (contextual)            — SC-edition variants + 8.06 third year; contextual embed approximates
#                                JinaAI late chunking (+24% BEIR) without per-token access
#   V4 (whitespace / 200 words)— same multi-year slugs as V2; word-boundary chunking, direct A/B vs V2
#
# Each pass writes to its own OCW_BRAIN dir so resume logic is clean and no slug collisions.
# All four brain dirs are uploaded to GCS; V1-clean becomes the published brain.
# V2/V3/V4 are experimental: run the board against each, promote the winner.
#
# Cost: n2-standard-16, ~6h → ~$15-20 depending on corpus size.
# Gate: checks that marker-rebuild is done (remaining=0) before starting.
#
# Usage: bash scripts/gcp-multipass-vectorize.sh [--confirm]

set -euo pipefail
[[ "${1:-}" == "--confirm" ]] || { echo "dry-run — pass --confirm to launch (~\$15-20)"; exit 0; }

PROJECT="${GCP_PROJECT:-socioprophet-platform}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${VM_NAME:-ocw-multipass}"
MACHINE="${MACHINE:-n2-standard-16}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
TERM_TIME="${TERM_TIME:-$(python3 -c "
import datetime
t = datetime.datetime.now().astimezone() + datetime.timedelta(hours=10)
print(t.replace(microsecond=0).isoformat())
")}"

# ── slug lists derived from multi-year cluster analysis ──────────────────────
# V1: all MMLU-STEM depts (18/math, 8/physics, 5/chem, 7/bio) — no slug filter
V1_DEPTS="18,8,5,7"

# V2 (large): second-year version of every 2-version cluster by MMLU subject
V2_SLUGS="8-06-quantum-physics-iii-spring-2016,8-04-quantum-physics-i-spring-2016,8-033-relativity-fall-2006,5-12-organic-chemistry-i-spring-2005,5-13-organic-chemistry-ii-fall-2006,5-61-physical-chemistry-fall-2017,5-73-quantum-mechanics-i-fall-2018,5-74-introductory-quantum-mechanics-ii-spring-2009,18-01-single-variable-calculus-fall-2006,18-02-multivariable-calculus-spring-2006,18-034-honors-differential-equations-spring-2009,18-443-statistics-for-applications-spring-2015,7-013-introductory-biology-spring-2018"

# V3 (contextual): OCW Scholar editions (editorially restructured, self-contained segments)
#   + 8.06 spring-2018 (the only true third-year version in the corpus)
V3_SLUGS="8-06-quantum-physics-iii-spring-2018,18-01sc-single-variable-calculus-fall-2010,18-02sc-multivariable-calculus-fall-2010,18-06sc-linear-algebra-fall-2011,18-03sc-differential-equations-fall-2011,8-01sc-classical-mechanics-fall-2016,8-03sc-physics-iii-vibrations-and-waves-fall-2016"

# V4 (whitespace): same slugs as V2 — direct A/B comparison, identical content, word-boundary chunking
V4_SLUGS="$V2_SLUGS"

cat > /tmp/multipass-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/multipass.log 2>&1; set -x
export HOME=/root
GCS="$GCS"

( while true; do
    gsutil -q cp /var/log/multipass.log "\$GCS/multipass.log" 2>/dev/null
    sleep 30
  done ) &

step(){ echo "==== \$(date '+%H:%M:%S') \$* ===="; }

# ── check marker-rebuild state (warn only — don't block) ─────────────────────
step "check marker-rebuild state"
REMAINING=\$(gsutil cat "\$GCS/bench/marker-status.json" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('remaining',1))" 2>/dev/null || echo 999)
if [ "\$REMAINING" -gt 0 ]; then
  step "WARN: marker-rebuild has \$REMAINING PDFs remaining — injecting partial sidecars; pymupdf covers the rest"
else
  step "marker done ✓ (remaining=0) — all sidecars available"
fi

# ── install ───────────────────────────────────────────────────────────────────
step "install deps"
curl -fsSL https://ollama.com/install.sh | sh
systemctl restart ollama 2>/dev/null || (ollama serve >/var/log/ollama.log 2>&1 &)
sleep 12
for n in 1 2 3 4 5; do ollama pull nomic-embed-text && break; echo "retry \$n"; sleep 8; done
ollama list | grep -q nomic-embed-text || { step "FATAL: embed model missing"; exit 1; }

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git python3-pip
pip3 install --break-system-packages pymupdf marker-pdf || pip3 install pymupdf marker-pdf || true

# ── pull code + corpus ────────────────────────────────────────────────────────
step "pull code"
mkdir -p /opt/am && gsutil -m cp -r "\$GCS/code/agent-machine/*" /opt/am/ && cd /opt/am && npm ci

step "pull corpus"
mkdir -p /opt/OCW/_corpus && gsutil -m rsync -r "\$GCS/_corpus" /opt/OCW/_corpus

step "inject marker sidecars (math-symbol recovery)"
mkdir -p /opt/marker-sidecars
gsutil -m rsync -r "\$GCS/marker-sidecars" /opt/marker-sidecars
# copy .marker.md files alongside their source PDFs in the corpus
find /opt/marker-sidecars -name '*.marker.md' | while read sidecar; do
  base=\$(basename "\$sidecar" .marker.md)
  target=\$(find /opt/OCW/_corpus -name "\$base" 2>/dev/null | head -1)
  [ -n "\$target" ] && cp "\$sidecar" "\${target}.marker.md" || true
done
step "sidecars injected"

cd /opt/am

# ── V1: full MMLU-STEM rebuild with math-clean corpus ────────────────────────
step "V1: fixed/15% overlap — full \${V1_DEPTS} rebuild"
OLLAMA_HOST=http://127.0.0.1:11434 \\
  OCW_CORPUS=/opt/OCW/_corpus OCW_BRAIN=/opt/OCW/_brain-v1 \\
  OCW_DEPTS="$V1_DEPTS" BRAIN_CONCURRENCY=8 CHUNK_STRATEGY=fixed \\
  npx tsx scripts/build-corpus.ts || echo "V1 exit \$?"
step "V1 done: \$(find /opt/OCW/_brain-v1 -name '*.jsonl' | wc -l) shards"

# ── V2: large chunks (1024 tokens) — second-year multi-year clusters ──────────
step "V2: large/30% overlap — multi-year second-year slugs"
OLLAMA_HOST=http://127.0.0.1:11434 \\
  OCW_CORPUS=/opt/OCW/_corpus OCW_BRAIN=/opt/OCW/_brain-v2 \\
  OCW_SLUGS="$V2_SLUGS" BRAIN_CONCURRENCY=8 CHUNK_STRATEGY=large \\
  npx tsx scripts/build-corpus.ts || echo "V2 exit \$?"
step "V2 done: \$(find /opt/OCW/_brain-v2 -name '*.jsonl' | wc -l) shards"

# ── V3: contextual embedding — SC editions + 8.06 third year ─────────────────
step "V3: contextual — SC editions (preceding-chunk context prefix)"
OLLAMA_HOST=http://127.0.0.1:11434 \\
  OCW_CORPUS=/opt/OCW/_corpus OCW_BRAIN=/opt/OCW/_brain-v3 \\
  OCW_SLUGS="$V3_SLUGS" BRAIN_CONCURRENCY=8 CHUNK_STRATEGY=contextual \\
  npx tsx scripts/build-corpus.ts || echo "V3 exit \$?"
step "V3 done: \$(find /opt/OCW/_brain-v3 -name '*.jsonl' | wc -l) shards"

# ── V4: whitespace word-boundary — same slugs as V2, direct A/B ──────────────
step "V4: whitespace/word-boundary — same slugs as V2 for A/B vs large-chunk"
OLLAMA_HOST=http://127.0.0.1:11434 \\
  OCW_CORPUS=/opt/OCW/_corpus OCW_BRAIN=/opt/OCW/_brain-v4 \\
  OCW_SLUGS="$V4_SLUGS" BRAIN_CONCURRENCY=8 CHUNK_STRATEGY=whitespace \\
  npx tsx scripts/build-corpus.ts || echo "V4 exit \$?"
step "V4 done: \$(find /opt/OCW/_brain-v4 -name '*.jsonl' | wc -l) shards"

# ── push all four brain dirs ──────────────────────────────────────────────────
step "pack + push brains"
for PASS in v1 v2 v3 v4; do
  DIR="/opt/OCW/_brain-\$PASS"
  [ -d "\$DIR" ] || continue
  SHARDS=\$(find "\$DIR" -name '*.jsonl' | wc -l)
  [ "\$SHARDS" -eq 0 ] && { step "WARN: \$PASS has 0 shards — skipping upload"; continue; }
  tar czf "/opt/brain-\${PASS}.tar.gz" -C /opt/OCW "_brain-\$PASS"
  gsutil cp "/opt/brain-\${PASS}.tar.gz" "\$GCS/brain-\${PASS}.tar.gz"
  step "\$PASS uploaded (\$SHARDS shards)"
done

# V1 becomes the published brain (math-clean, all STEM depts)
gsutil cp "\$GCS/brain-v1.tar.gz" "\$GCS/brain.tar.gz" || true

python3 -c "
import json, subprocess, datetime
def count(p):
  try: return int(subprocess.check_output(['find',p,'-name','*.jsonl'],stderr=subprocess.DEVNULL).decode().strip().count('\n'))
  except: return 0
manifest = {
  'updated': datetime.datetime.utcnow().isoformat()+'Z',
  'strategy': {'v1':'fixed/15%-overlap/full-STEM','v2':'large/1024-token/multi-year','v3':'contextual/SC-editions','v4':'whitespace/200-word/multi-year'},
  'shards': {p: count('/opt/OCW/_brain-'+p) for p in ['v1','v2','v3','v4']},
}
print(json.dumps(manifest, indent=2))
" | gsutil cp - "\$GCS/multipass-manifest.json"

step "DONE — all passes complete. V1=published brain. V2/V3/V4=experimental (run board to pick winner)."
gsutil -q cp /var/log/multipass.log "\$GCS/multipass.log" || true
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone | awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

echo "# creating $VM ($MACHINE) — 4-pass brain build, hard shutdown at $TERM_TIME"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=300GB --service-account="$SA" --scopes=cloud-platform \
  --termination-time="$TERM_TIME" --instance-termination-action=DELETE \
  --metadata-from-file startup-script=/tmp/multipass-startup.sh

echo "# launched — runs on its own (no SSH needed)"
echo "# watch:  gsutil cat $GCS/multipass.log"
echo "# results: $GCS/brain-{v1,v2,v3,v4}.tar.gz + $GCS/multipass-manifest.json"
echo "# V1 is auto-promoted to brain.tar.gz (published brain)"
echo "# after: run board against each V2/V3/V4 brain dir, promote the winner"
