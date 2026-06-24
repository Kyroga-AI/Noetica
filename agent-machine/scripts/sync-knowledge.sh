#!/bin/bash
# sync-knowledge — the canon → everything feedback loop (#4). Re-run after ANY canon change (capture →
# recover → author): it regenerates the keyed-vec alignment, the sense-aware cross-domain links, the
# HellGraph ingest (Domain→Topic→Term/Formula with kvClass), and the governed ontogenesis module — so the
# brain (retrieval), the graph (exploration), and the ontology (governance) stay aligned on ONE
# re-generatable source. Drift can't ship silently: the ontogenesis SHACL gate fails on a bad module.
set -uo pipefail
cd "$(dirname "$0")/.."
echo "════ sync-knowledge — canon → {alignment, graph, ontology} ════"
echo "▸ 1/4 keyed-vec alignment (canon topics → MMLU/MMLU-Pro coverage + the holes)"
python3 scripts/canon-keyvec-align.py 2>&1 | grep -E '#|HOLE|wrote' | tail -3
echo "▸ 2/4 sense-aware cross-domain links"
python3 scripts/canon-graph-links.py 2>&1 | grep -E '#|links|wrote' | tail -2
echo "▸ 3/4 HellGraph ingest (kvClass default linking class + cross-domain edges)"
node --import tsx scripts/canon-to-graph.ts 2>&1 | grep -E 'Domain|kvClass|renders' | tail -2
echo "▸ 4/4 governed ontogenesis module (re-generate + SHACL-gate before it ships)"
if [ -f scripts/canon-to-ontogenesis.py ]; then
  python3 scripts/canon-to-ontogenesis.py 2>&1 | tail -2
  if [ -d "$HOME/dev/ontogenesis" ]; then
    ( cd "$HOME/dev/ontogenesis" && python3 scripts/shacl_gate.py 2>&1 | grep -iE 'conforms' | tail -1 )
  fi
fi
echo "✓ knowledge sync complete — brain / graph / ontology aligned on the canon"
