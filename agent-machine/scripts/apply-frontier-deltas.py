#!/usr/bin/env python3
"""apply-frontier-deltas — the learning apparatus's write-back step. Merges FRONTIER-authored knowledge deltas
(frontier-canon-deltas.jsonl) into the canon spec glossaries, so each wrong answer's lesson is written into the
BRAIN by the frontier — never the local model. Box-free: pure file ops. The little model just gets re-graded."""
import json, os, glob
CANON = os.path.join(os.path.dirname(__file__), '..', 'canon')
DELTAS = os.path.expanduser('~/.noetica/frontier-canon-deltas.jsonl')
SUBJ2DOMAIN = {'chemistry':'chemistry','physics':'physics','mathematics':'mathematics','biology':'biology',
               'computer':'computer_science','economics':'economics','medicine':'medicine','algebra':'mathematics'}
def domain_of(miss):
    s = miss.lower()
    for k,v in SUBJ2DOMAIN.items():
        if k in s: return v
    return None
applied = 0
for line in open(DELTAS):
    if not line.strip(): continue
    d = json.loads(line)
    if d.get('term') == 'DATA-QA FLAG' or not d.get('verified'): continue   # flags aren't canon, they're QA
    dom = domain_of(d['miss'])
    f = os.path.join(CANON, f'spec-{dom}.json')
    if not dom or not os.path.exists(f): print(f"  skip (no spec): {d['miss']}"); continue
    spec = json.load(open(f))
    topic = spec['topics'][0]                      # attach to the domain's first topic (frontier-authored layer)
    topic.setdefault('glossary', [])
    if any(g.get('term')==d['term'] for g in topic['glossary']):
        print(f"  exists: {d['term']}"); continue
    topic['glossary'].append({'term': d['term'], 'definition': d['definition'], 'source': 'frontier-remediation'})
    json.dump(spec, open(f,'w'), indent=1, ensure_ascii=False)
    applied += 1
    print(f"  ✓ {dom}: +'{d['term']}' (frontier-authored, from {d['miss']})")
print(f"applied {applied} frontier deltas into the canon")
