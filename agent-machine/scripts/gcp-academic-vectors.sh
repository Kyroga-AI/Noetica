#!/bin/bash
# gcp-academic-vectors — train the purely-academic fastText backbone on GCP (off the Air). Pulls the
# pre-assembled OCW corpus from GCS, trains subword fastText (dim 300), uploads ocw-academic.kv, self-deletes.
set -uo pipefail
PROJECT="${GCP_PROJECT:-socioprophet-platform}"
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus/academic"
SA="${GCP_SA:-sourceos-ci@socioprophet-platform.iam.gserviceaccount.com}"
VM="academic-vectors"
MACHINE="${MACHINE:-c2d-standard-16}"
CORPUS_OBJ="${CORPUS_OBJ:-_academic_corpus.txt}"     # set to _academic_corpus_clean.txt for the cleaned retrain
ZONES="${ZONES:-us-east1-b us-east1-c us-east1-d us-central1-a us-central1-b us-central1-c us-west1-a us-west1-b}"
TERM=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(hours=6)).replace(microsecond=0).isoformat())")

ex=$(gcloud compute instances list --project=$PROJECT --filter="name=$VM" --format="value(name)" 2>/dev/null)
[ -n "$ex" ] && { echo "ABORT — $VM exists"; exit 0; }

cat > /tmp/av-startup.sh <<STARTUP
#!/bin/bash
exec >/var/log/av.log 2>&1; set -x
GCS="$GCS"
( while true; do gsutil -q cp /var/log/av.log "\$GCS/academic-vectors.log" 2>/dev/null; sleep 20; done ) &
apt-get update -y && apt-get install -y python3-pip
pip3 install --break-system-packages -q gensim numpy || pip3 install -q gensim numpy
mkdir -p /opt/av && cd /opt/av
gsutil cp "\$GCS/$CORPUS_OBJ" /opt/av/corpus.txt
python3 - <<'PY'
import os
from gensim.models import Word2Vec
print('training Word2Vec backbone (dim 300, skip-gram, min_count 20, 5 epochs — NO subword: semantic neighbours, not spelling) ...', flush=True)
m = Word2Vec(corpus_file='/opt/av/corpus.txt', vector_size=300, window=5, min_count=20,
             sg=1, epochs=5, workers=os.cpu_count() or 8)
m.wv.save('/opt/av/ocw-academic.kv')
print('# vocab', len(m.wv), flush=True)
for t in ['eigenstate','homomorphism','entropy','torque','manifold','enzyme','eigenvalue','hamiltonian']:
    if t in m.wv: print('  ', t, '->', ', '.join(w for w,_ in m.wv.most_similar(t, topn=6)), flush=True)
PY
tar -czf /opt/av/ocw-academic-kv.tgz -C /opt/av \$(ls /opt/av | grep '^ocw-academic.kv')
gsutil cp /opt/av/ocw-academic-kv.tgz "\$GCS/ocw-academic-kv.tgz" && echo "==== uploaded ocw-academic-kv.tgz ===="
echo "==== DONE — self-delete ===="
N=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/name)
Z=\$(curl -s -H "Metadata-Flavor: Google" http://metadata/computeMetadata/v1/instance/zone|awk -F/ '{print \$NF}')
gcloud compute instances delete "\$N" --zone="\$Z" --quiet
STARTUP

for Z in $ZONES; do
  echo "  trying $VM ($MACHINE) in $Z"
  if gcloud compute instances create $VM --project=$PROJECT --zone=$Z --machine-type=$MACHINE \
      --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
      --metadata-from-file startup-script=/tmp/av-startup.sh \
      --boot-disk-size=60GB --service-account=$SA --scopes=cloud-platform \
      --termination-time="$TERM" --instance-termination-action=DELETE >/dev/null 2>&1; then
    echo "=== academic-vectors LAUNCHED in $Z — watch: gcloud storage cat $GCS/academic-vectors.log ==="; exit 0
  fi
  echo "    $Z failed, next"
done
echo "FATAL — all zones failed"; exit 1
