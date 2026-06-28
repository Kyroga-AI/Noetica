#!/usr/bin/env python3
"""
slice-spaces — the multi-axis LATTICE over the academic corpus. One tagged corpus → conditional spaces along
verticals (domain ⊃ course) and horizontals (material, level), derivable by aggregation (no per-slice training).

For each slice it computes:
  • SIGNATURE — the terms most OVER-represented in the slice vs the global corpus (slice_tf / global_tf). Needs
    no vectors → shows immediately what defines exam-space vs lecture-space, grad vs intro, physics vs math.
  • CENTROID  — when a KeyedVectors source is given (the academic backbone ocw-academic.kv, else GloVe), the
    mean vector of the slice's signature terms → slice-to-slice comparison + the cross-slice sense differences.

Output: ~/.noetica/vectors/slice-spaces.json. Run AGAIN with the academic backbone once trained to get the
purely-academic conditional spaces.

Run:  KV=academic python3 scripts/slice-spaces.py        (KV=glove fallback while the backbone trains)
Env:  KV(academic|glove)  TOPSIG(20)  FIELDS(stem)
"""
import os, re, json, glob
from collections import defaultdict, Counter
import numpy as np

HOME = os.path.expanduser('~')
BRAIN = os.environ.get('OCW_BRAIN', os.path.join(HOME, 'Downloads', 'MIT OCW', '_brain'))
OUT = os.path.join(HOME, '.noetica', 'vectors'); os.makedirs(OUT, exist_ok=True)
FIELDS = os.environ.get('FIELDS', 'physics,mathematics,chemistry,biology,eecs,biological_eng,earth_planetary').split(',')
KV_SRC = os.environ.get('KV', 'academic')
TOPSIG = int(os.environ.get('TOPSIG', '20'))
MINCOUNT = int(os.environ.get('MINCOUNT', '8'))
_tok = re.compile(r"[a-z][a-z0-9'+-]*")
STOP = set('the a an of to and or in on for with is are be this that as by from at it we you they an its their'.split())


def level_bucket(lv):
    try:
        n = int(lv)
    except Exception:
        return 'unknown'
    return 'intro' if n < 100 else ('undergrad' if n < 400 else 'grad')   # MIT subject-level heuristic


def main():
    # axis -> slice value -> Counter(token); plus global
    axes = ['domain', 'material', 'level', 'course']
    slices = {a: defaultdict(Counter) for a in axes}
    glob_ct = Counter(); ntok = 0; nchunk = 0
    for field in FIELDS:
        d = os.path.join(BRAIN, field)
        if not os.path.isdir(d):
            continue
        for fn in glob.glob(os.path.join(d, '*.jsonl')):
            for ln in open(fn, errors='replace'):
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                t = o.get('text', '')
                if len(t) < 40 or t.count('�') / max(1, len(t)) > 0.02:
                    continue
                toks = [w for w in _tok.findall(t.lower()) if w not in STOP and len(w) > 2]
                if len(toks) < 8:
                    continue
                c = Counter(toks); glob_ct.update(c); ntok += sum(c.values()); nchunk += 1
                tags = {'domain': field, 'material': o.get('material', '?'),
                        'level': level_bucket(o.get('level', '?')), 'course': o.get('slug', '?')}
                for a in axes:
                    slices[a][tags[a]].update(c)
    print(f"# {nchunk} chunks · {ntok:,} tokens · global vocab {len(glob_ct):,}", flush=True)

    # signatures: term over-representation = (slice_tf / slice_total) / (global_tf / global_total)
    G = sum(glob_ct.values())
    def signature(ct, topn):
        S = sum(ct.values())
        if S < 200:
            return []
        scored = []
        for w, c in ct.items():
            if c < MINCOUNT or glob_ct[w] < 30 or len(w) < 3 or not w.isalpha():
                continue                                  # skip near-hapax OCR junk / hashes / fragments
            lift = (c / S) / (glob_ct[w] / G)
            scored.append((lift * np.log1p(c), w, c))     # dampen by frequency: frequent+over-represented wins
        scored.sort(reverse=True)
        return [w for _, w, _ in scored[:topn]]

    sig = {a: {} for a in axes}
    for a in axes:
        for val, ct in slices[a].items():
            s = signature(ct, TOPSIG)
            if s:
                sig[a][val] = s

    # optional vectors → slice centroids + nearest slices
    kv = None
    try:
        if KV_SRC == 'academic' and os.path.exists(os.path.join(OUT, 'ocw-academic.kv')):
            from gensim.models import KeyedVectors
            kv = KeyedVectors.load(os.path.join(OUT, 'ocw-academic.kv')); src = 'ocw-academic (ours)'
        else:
            import gensim.downloader as api
            kv = api.load('glove-wiki-gigaword-300'); src = 'glove (fallback)'
        print(f"# vectors: {src}", flush=True)
    except Exception as e:
        print(f"# no vectors ({str(e)[:50]}) — signatures only", flush=True)

    centroids = {}
    def centroid(terms):
        vs = [kv[w] for w in terms if kv is not None and w in kv]
        if not vs:
            return None
        v = np.mean(vs, 0); n = np.linalg.norm(v); return v / n if n else None

    if kv is not None:
        for a in axes:
            for val, terms in sig[a].items():
                v = centroid(terms)
                if v is not None:
                    centroids[f"{a}:{val}"] = v

    # ── report ──
    print("\n## HORIZONTAL — material (what vocabulary defines each pedagogical role):")
    for val in ('exam', 'solution', 'lecture', 'reference'):
        if val in sig['material']:
            print(f"  {val:10} ▸ {', '.join(sig['material'][val][:12])}")
    print("\n## HORIZONTAL — level (intro vs grad, the MMLU↔MMLU-Pro axis):")
    for val in ('intro', 'undergrad', 'grad'):
        if val in sig['level']:
            print(f"  {val:10} ▸ {', '.join(sig['level'][val][:12])}")
    print("\n## VERTICAL — domain signatures:")
    for val, s in sig['domain'].items():
        print(f"  {val:14} ▸ {', '.join(s[:10])}")

    if centroids:
        names = list(centroids); M = np.vstack([centroids[n] for n in names])
        print("\n## cross-slice nearest (the lattice geometry):")
        for probe in ['material:exam', 'level:grad', 'domain:physics']:
            if probe in centroids:
                i = names.index(probe); s = M @ M[i]; s[i] = -9
                order = np.argsort(-s)[:3]
                print(f"  {probe:18} ~ " + ', '.join(f'{names[j]}({s[j]:.2f})' for j in order))

    out = {'kv': KV_SRC if kv is not None else None, 'axes': axes,
           'signatures': sig,
           'centroids': {k: [round(float(x), 4) for x in v] for k, v in centroids.items()}}
    json.dump(out, open(os.path.join(OUT, 'slice-spaces.json'), 'w'))
    print(f"\n# wrote slice-spaces.json ({sum(len(sig[a]) for a in axes)} slices across {len(axes)} axes)")


if __name__ == '__main__':
    main()
