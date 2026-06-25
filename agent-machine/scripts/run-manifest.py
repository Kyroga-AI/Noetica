#!/usr/bin/env python3
"""run-manifest — emit a FULLY AUDITABLE provenance manifest for a board run. Every locked-in number must
trace to exactly what produced it: which NS techniques, which RAG techniques, which retrieval knobs, which
features were captured, the MODEL, and the SHA256 of every script + every canon artifact (the symbol table
+ the operator catalog) that shaped the result. So a board number is reproducible to the code + symbol
versions, not just a float. Pairs with the PIT discipline: the manifest IS the point-in-time stamp.

Usage:  python3 scripts/run-manifest.py <out.json>      # reads MMLU_* env for arms/seed/knobs/model
"""
import sys, os, json, hashlib, subprocess, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def sha(rel):
    try:
        h = hashlib.sha256()
        with open(os.path.join(ROOT, rel), 'rb') as f:
            for b in iter(lambda: f.read(65536), b''):
                h.update(b)
        return h.hexdigest()[:16]
    except Exception:
        return None

# the code that shapes a result — board + the NS solvers + the symbol/graph libs
SCRIPTS = ['scripts/mmlu-brain-bench.ts', 'scripts/compute_arm.py', 'scripts/model_solve.py',
           'scripts/model_verify.py', 'scripts/units.py', 'scripts/chain_solve.py', 'scripts/math_solve.py',
           'lib/canon-lookup.ts', 'lib/canon-route.ts', 'lib/reliability-gate.ts', 'lib/brain-vec.ts']
# the symbol table (glossary) + operators (equations) + the graph (prereq/links/hierarchy) + calibration
CANON = ['canon/glossary.json', 'canon/canonical-equations.json', 'canon/prereq-dag.json',
         'canon/lexical-hierarchy.json', 'canon/cross-domain-links.json', 'canon/cards.jsonl',
         'canon/reliability-reference.json']
NS_ARMS = {'compute', 'verify', 'autoform', 'ladder', 'elim', 'fiftyfifty', 'route', 'champion', 'gate', 'learned'}
RAG_ARMS = {'brain', 'rerank', 'ground', 'qgen', 'hop', 'cohere', 'notecard'}

def git_rev():
    try:
        return subprocess.check_output(['git', '-C', ROOT, 'rev-parse', '--short', 'HEAD'],
                                       stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return None

arms = os.environ.get('MMLU_ARMS', 'baseline,brain').split(',')
man = {
    'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'git': git_rev(),
    'model': os.environ.get('MMLU_MODEL', 'llama3.2:3b'),
    'seed': os.environ.get('MMLU_SEED'),
    'per_subject': os.environ.get('MMLU_PER_SUBJECT'),
    'techniques': {
        'ns': [a for a in arms if a in NS_ARMS],
        'rag': [a for a in arms if a in RAG_ARMS],
        'base': [a for a in arms if a not in NS_ARMS and a not in RAG_ARMS],
    },
    'retrieval_knobs': {k: os.environ.get(k) for k in
                        ['MMLU_HYBRID', 'MMLU_MMR', 'MMLU_PER_SHOT', 'MMLU_SHOT_K', 'MMLU_K',
                         'MMLU_RERANK_N', 'MMLU_COMPUTE_GROUND', 'MMLU_ELIM_K'] if os.environ.get(k) is not None},
    'features_captured': ['cohere.feats[]', 'ladder.stages[]', 'gate_reliability', 'gate_decision',
                          'gate_agree', 'gate_typical', 'brain_conf', '<arm>_pred', '<arm>_ok', '<arm>_mode'],
    'script_sha256': {p: sha(p) for p in SCRIPTS},
    'canon_sha256': {p: sha(p) for p in CANON},
}
# audit the symbol substrate sizes (operators + symbols), so growth is tracked across runs
try:
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    from model_solve import MODELS
    man['operators_catalog_n'] = len(MODELS)
except Exception:
    man['operators_catalog_n'] = None
try:
    g = json.load(open(os.path.join(ROOT, 'canon/glossary.json')))
    man['glossary_terms_n'] = sum(len(v) for v in g.values() if isinstance(v, dict))
except Exception:
    man['glossary_terms_n'] = None

out = sys.argv[1] if len(sys.argv) > 1 else '/dev/stdout'
json.dump(man, open(out, 'w'), indent=1)
print(f"manifest → {out}  ns={man['techniques']['ns']} rag={man['techniques']['rag']} "
      f"knobs={list(man['retrieval_knobs'])} ops={man['operators_catalog_n']} symbols={man['glossary_terms_n']} git={man['git']}")
