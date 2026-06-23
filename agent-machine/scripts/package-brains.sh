#!/usr/bin/env bash
# package-brains — tar the shippable brains (academic OCW + operational manpages) into .tar.gz artifacts
# that lib/brain-provision.ts can download + extract. Upload these to a public https URL and point
# NOETICA_BRAIN_ACADEMIC_URL / NOETICA_BRAIN_OPS_URL at them; a fresh install then self-provisions via
# POST /api/brain/provision. (The chat brain is personal and is never packaged or shipped.)
#
# Usage:  bash scripts/package-brains.sh        # writes to ./dist/brains (override with OUT=…)
set -euo pipefail

OUT="${OUT:-$PWD/dist/brains}"
mkdir -p "$OUT"

# Resolve the academic brain dir — mirrors lib/brain-home.ts: OCW_BRAIN > ~/.noetica/brains/academic > legacy.
ACAD="${OCW_BRAIN:-}"
if [ -z "$ACAD" ]; then
  for c in "$HOME/.noetica/brains/academic" "$HOME/Downloads/MIT OCW/_brain"; do
    [ -d "$c" ] && ACAD="$c" && break
  done
fi
# Resolve the ops corpus file: OPS_CORPUS > ~/.noetica/brains/operational/manpages.jsonl > legacy.
OPS="${OPS_CORPUS:-}"
if [ -z "$OPS" ]; then
  for c in "$HOME/.noetica/brains/operational/manpages.jsonl" "$HOME/.noetica/ops-corpus/manpages.jsonl"; do
    [ -f "$c" ] && OPS="$c" && break
  done
fi

# pack <name> <src-dir> <artifact> — tar the CONTENTS of src-dir (so extract drops them straight into the
# provision target), then print size + sha256 for integrity.
pack() {
  local name="$1" src="$2" art="$3"
  if [ -z "$src" ] || [ ! -e "$src" ]; then echo "# skip $name — not found (set its env or build it first)"; return; fi
  echo "# packaging $name from $src"
  tar -czf "$art" -C "$src" .
  local sha size
  sha=$(shasum -a 256 "$art" | awk '{print $1}')
  size=$(du -h "$art" | awk '{print $1}')
  echo "  -> $art  ($size, sha256 $sha)"
}

pack "academic"    "$ACAD"                 "$OUT/academic-brain.tar.gz"
# the ops corpus is a single file; pack its containing dir so extract drops manpages.jsonl into operational/
[ -n "$OPS" ] && pack "operational" "$(dirname "$OPS")" "$OUT/operational-brain.tar.gz"

echo
echo "# Next: upload the artifact(s) above to a STABLE public https URL (GCS object, S3, etc.)."
echo "#"
echo "# For FULL automation — set these repo VARIABLES once, and the release CI (attach-brains job)"
echo "# mirrors them onto every stable release, so installs auto-load via .../releases/latest/download:"
echo "#   gh variable set BRAIN_ACADEMIC_URL --body https://.../academic-brain.tar.gz"
echo "#   gh variable set BRAIN_OPS_URL      --body https://.../operational-brain.tar.gz"
echo "#"
echo "# Manual alternative on a target machine:"
echo "#   export NOETICA_BRAIN_ACADEMIC_URL=https://.../academic-brain.tar.gz   # then:"
echo "#   curl -N -X POST localhost:8080/api/brain/provision -d '{\"name\":\"academic\"}'"
echo "# Check anytime:   curl -s localhost:8080/api/brain/status | jq"
