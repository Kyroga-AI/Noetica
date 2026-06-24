#!/usr/bin/env python3
"""
clean-academic-corpus — strip OCR-fragment tokens from the academic corpus so the re-trained vectors carry
SEMANTIC neighbours, not spelling junk (the equilibrium→ibrium failure). Deterministic (no model): a fragment
is a RARE, non-word token that is a prefix/suffix truncation of a GOOD word — rque⊂torque, ibrium⊂equilibrium,
ntropy⊂entropy, igenvalue⊂eigenvalue. Dropped entirely, so they never get a vector → can't pollute neighbours.
GOOD vocab = frequent corpus tokens ∪ English dictionary ∪ canon glossary terms (so real words are never cut).

This is the #2 lever: clean corpus → retrain Word2Vec → clean academic lens → promote to primary.
Run:  python3 scripts/clean-academic-corpus.py    Env: CORPUS OUT GOOD_MIN(60) FRAG_MAX(300)
"""
import os, re, json, glob
from collections import Counter

HOME = os.path.expanduser('~')
CORPUS = os.environ.get('CORPUS', os.path.join(HOME, '.noetica', 'vectors', '_academic_corpus.txt'))
OUT = os.environ.get('OUT', os.path.join(HOME, '.noetica', 'vectors', '_academic_corpus_clean.txt'))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOOD_MIN = int(os.environ.get('GOOD_MIN', '60'))      # corpus freq ≥ → assume a real word (keep)
FRAG_MAX = int(os.environ.get('FRAG_MAX', '300'))     # only rare tokens are fragment candidates


def main():
    if not os.path.exists(CORPUS):
        raise SystemExit(f"no corpus at {CORPUS} (run train-academic-vectors first, or set CORPUS=)")
    freq = Counter()
    with open(CORPUS, errors='replace') as f:
        for line in f:
            freq.update(line.split())
    print(f"# corpus vocab {len(freq):,} tokens", flush=True)

    good = {w for w, c in freq.items() if c >= GOOD_MIN}              # frequent = real
    try:
        good |= {w.strip().lower() for w in open('/usr/share/dict/words') if w.strip().isalpha()}
    except Exception:
        pass
    for spec in glob.glob(os.path.join(HERE, 'canon', 'spec-*.json')):   # canon terms are always real
        try:
            s = json.load(open(spec))
        except Exception:
            continue
        for t in s.get('topics', []):
            for g in t.get('glossary', []):
                good.update(re.findall(r"[a-z][a-z'-]+", (g.get('term', '') or '').lower()))
    print(f"# good vocab {len(good):,} (frequent ∪ dict ∪ canon)", flush=True)

    # prefix/suffix index of good words (catch truncation fragments)
    affix = set()
    for w in good:
        L = len(w)
        if L < 5:
            continue
        for k in range(3, min(11, L)):       # proper affixes shorter than the word
            affix.add(w[:k]); affix.add(w[-k:])

    frags = {w for w, c in freq.items()
             if w not in good and c < FRAG_MAX and w.isalpha() and 3 <= len(w) <= 10 and w in affix}
    print(f"# {len(frags):,} OCR-fragment tokens flagged → drop · e.g. {', '.join(sorted(frags)[:14])}", flush=True)

    kept = dropped = lines_in = lines_out = 0
    with open(CORPUS, errors='replace') as f, open(OUT, 'w') as o:
        for line in f:
            lines_in += 1
            toks = line.split()
            clean = [t for t in toks if t not in frags]
            dropped += len(toks) - len(clean); kept += len(clean)
            if len(clean) >= 5:
                o.write(' '.join(clean) + '\n'); lines_out += 1
    print(f"# wrote {OUT}")
    print(f"  dropped {dropped:,} fragment occurrences · kept {kept:,} tokens · {lines_out:,}/{lines_in:,} lines")
    print("## known-bad fragments (should all be DROPPED):")
    for bad in ['ibrium', 'rque', 'ntropy', 'equilib', 'rivative', 'igenvalue', 'amiltonian', 'ywheel']:
        st = 'DROPPED ✓' if bad in frags else ('kept-as-good' if bad in good else 'not-in-corpus')
        print(f"  {bad:12} {st}")


if __name__ == '__main__':
    main()
