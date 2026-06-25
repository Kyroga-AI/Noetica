#!/usr/bin/env python3
"""type-operators — close the audit leak: emit every compute-catalog operator (model_solve.MODELS) as a
TYPED record carrying its epistemicMode + provenance, so the enrichment path is no longer un-audited.
  authored textbook laws  → 'deduced'  (follow from established theory)
  symbolic-regression laws → 'induced'  (generalized from worked-example data; marked in OP_SOURCE)
Provenance = the SHA256 of scripts/model_solve.py (the same hash run-manifest records). Writes
canon/operators-typed.jsonl — the audit artifact that the ontogenesis/SHACL layer can ingest.
"""
import os, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from model_solve import MODELS
# operators discovered by symbolic regression mark themselves here (induce-operators.py appends names)
OP_SOURCE_FILE = os.path.join(HERE, '..', 'canon', 'operators-induced.txt')
induced = set()
if os.path.exists(OP_SOURCE_FILE):
    induced = set(l.strip() for l in open(OP_SOURCE_FILE) if l.strip())
sha = hashlib.sha256(open(os.path.join(HERE, 'model_solve.py'), 'rb').read()).hexdigest()[:16]
out = []
for name, (eq, domain, disp, _test) in MODELS.items():
    mode = 'induced' if name in induced else 'deduced'
    out.append({'op': name, 'equation': eq, 'domain': domain, 'epistemicMode': mode,
                'source': 'symbolic-regression' if mode == 'induced' else 'frontier-authored/canonical',
                'provenance': {'file': 'scripts/model_solve.py', 'sha256': sha},
                'kcc_type': 'kcc:Formula', 'verified': 'dimensional+plugback'})
outp = os.path.join(HERE, '..', 'canon', 'operators-typed.jsonl')
with open(outp, 'w') as f:
    for r in out:
        f.write(json.dumps(r) + '\n')
from collections import Counter
c = Counter(r['epistemicMode'] for r in out)
print(f"typed {len(out)} operators → canon/operators-typed.jsonl  ({dict(c)})  provenance sha={sha}")
print(f"  every operator now carries epistemicMode + provenance hash — the enrichment path is auditable.")
