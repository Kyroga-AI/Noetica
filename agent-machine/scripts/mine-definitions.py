#!/usr/bin/env python3
"""
mine-definitions — Hearst/genus-differentia definition mining over the OCW brain corpus, to grow the canonical
concept glossary (canon/spec-*.json) from the same course materials the brain is built on.

Why: the glossary is hand-curated and incomplete; the grounding signal (canonEntities / the groundgate arm)
is only as good as its coverage. The OCW corpus IS the source of truth for "what a STEM concept means," so
mine clean term->definition pairs straight from it — GENERAL textbook knowledge, never test-item answers
(clean-eval safe).

Design = PRECISION over recall (a curated glossary must stay clean):
  * only high-confidence definitional forms ("X is a/an/the Y", "X is defined as Y", "X refers to Y")
  * aggressive noise filters (generic academic words, extraction artifacts, pronouns)
  * a frequency floor — a term defined consistently across MANY materials is a real concept, not a fluke
  * dedup against the existing spec glossary (+ aliases) so we only surface NEW terms

This tool's job is DISCOVERY, not authoring. It surfaces which standard concepts the corpus actually uses
that are missing from the spec, plus a rough mined definition for context. The clean glossary definition is
then written by a FRONTIER model (the curator) — never the local 7B the glossary exists to compensate for
(letting the weak model author the canon would cap the canon at its own knowledge). So: miner discovers terms
-> frontier model authors the definition -> merge the vetted winners. We do not blind-dump mined noise (the
mined defs are thin/context-bound at ~45% precision) into the curated spec.

Output: ranked candidate term->definition pairs as JSON for review before merge.

Usage:
  python3 scripts/mine-definitions.py <field> [--brain DIR] [--spec FILE] [--min-freq N] [--top N] [--out FILE]
  e.g. python3 scripts/mine-definitions.py mathematics --spec canon/spec-mathematics.json --out /tmp/mined-mathematics.json
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

# ── term hygiene ──────────────────────────────────────────────────────────────
# Generic academic / discourse words that form spurious "X is a Y" sentences in lecture notes
# ("the answer is a number", "this example is a case of..."). A glossary term must be a CONCEPT.
GENERIC = {
    'answer', 'problem', 'result', 'example', 'solution', 'question', 'value', 'number', 'case', 'thing',
    'idea', 'point', 'part', 'way', 'fact', 'reason', 'goal', 'step', 'note', 'figure', 'table', 'section',
    'chapter', 'lecture', 'exam', 'homework', 'exercise', 'problem set', 'following', 'above', 'below',
    'student', 'course', 'class', 'term', 'word', 'name', 'kind', 'sort', 'type', 'form', 'piece', 'set of',
    'one', 'two', 'three', 'first', 'second', 'third', 'last', 'next', 'figure below', 'graph', 'plot',
}
# Leading tokens that mean the "term" is really a pronoun/discourse marker, not a concept.
BAD_LEAD = {
    'this', 'that', 'these', 'those', 'it', 'they', 'there', 'here', 'we', 'he', 'she', 'you', 'i', 'one',
    'each', 'every', 'any', 'some', 'all', 'both', 'either', 'neither', 'such', 'what', 'which', 'who',
    'where', 'when', 'why', 'how', 'his', 'her', 'its', 'their', 'our', 'your', 'my', 'another', 'other',
    'if', 'then', 'so', 'thus', 'hence', 'therefore', 'now', 'today', 'above', 'below', 'figure', 'table',
}
STOP_IN_TERM = {'is', 'are', 'was', 'were', 'be', 'been', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for'}
# Discourse / possessive / deictic words: if ANY appears in the candidate term, it isn't a clean concept NP
# ("choice we have given", "distance we want", "fourth one", "simplest function").
TERM_FUNCWORDS = {
    'we', 'our', 'us', 'you', 'your', 'my', 'their', 'his', 'her', 'its', 'have', 'has', 'had', 'want',
    'given', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'one', 'ones', 'same',
    'only', 'just', 'very', 'more', 'most', 'less', 'also', 'then', 'now', 'here', 'there', 'such', 'good',
    'simplest', 'usual', 'natural', 'general', 'special', 'particular', 'whole', 'entire', 'fourth', 'fifth',
    'left', 'right', 'top', 'bottom', 'main', 'real', 'true', 'false', 'new', 'old', 'big', 'small',
}
# Context-dependent cues in a DEFINITION: a glossary def must be self-contained, not "the path illustrated".
DEF_CONTEXT = re.compile(
    r'\b(illustrat|shown|depict|pictur|drawn|above|below|following|as before|as shown|as above|in the figure'
    r'|in the picture|in the diagram|this case|that case|we want|we have|we will|we get|we obtain|our '
    r'|here|earlier|previous|the picture|the figure|the diagram)\b', re.I)
VAR_SUFFIX = re.compile(r'\b[a-z]{1,3}\d*$')             # trailing lone variable: "group g", "cofactor aij"

# ── definitional patterns (run on a single sentence) ──────────────────────────
# Each captures (term, definition). The term is the leading noun phrase; the cue verb signals a definition.
PATTERNS = [
    # "A/An/The <term> is a/an/the <def>"  — genus-differentia, the cleanest definitional form
    re.compile(r'^(?:An?|The)\s+([A-Za-z][A-Za-z\- ]{2,38}?)\s+is\s+(an?|the)\s+([a-z].{12,240}?)[.;]', re.I),
    # "<Term> is defined as/to be <def>"
    re.compile(r'^([A-Za-z][A-Za-z\- ]{2,38}?)\s+is\s+defined\s+(?:as|to\s+be)\s+([a-z].{12,240}?)[.;]', re.I),
    # "<Term> refers to <def>"
    re.compile(r'^([A-Za-z][A-Za-z\- ]{2,38}?)\s+refers?\s+to\s+([a-z].{12,240}?)[.;]', re.I),
]

SENT_SPLIT = re.compile(r'(?<=[.;])\s+')
WS = re.compile(r'\s+')


def clean_text(t: str) -> str:
    return WS.sub(' ', t.replace('\n', ' ')).strip()


def looks_artifacted(s: str) -> bool:
    """Reject extraction junk: replacement chars, or too many 1-char 'words' (lost spacing/hyphens)."""
    if '�' in s or '�' in s:
        return True
    toks = s.split()
    if not toks:
        return True
    singles = sum(1 for w in toks if len(w) == 1 and w.isalpha())
    return singles > max(2, len(toks) // 4)


def norm_term(raw: str) -> str | None:
    """Lowercase, strip a leading article, validate it's a plausible concept noun phrase. None = reject."""
    t = clean_text(raw).lower().strip(' -')
    t = re.sub(r'^(a|an|the)\s+', '', t)
    if not (3 <= len(t) <= 40):
        return None
    words = t.split()
    if not words or len(words) > 4:
        return None
    if words[0] in BAD_LEAD or t in GENERIC or words[0] in GENERIC:
        return None
    if any(w in STOP_IN_TERM or w in TERM_FUNCWORDS for w in words):   # discourse/possessive word → not a concept
        return None
    if not re.fullmatch(r'[a-z][a-z\- ]*[a-z]', t):     # letters/hyphen/space only, alpha-bounded
        return None
    if not any(len(w) >= 4 for w in words):             # needs a real content word
        return None
    if len(words) > 1 and VAR_SUFFIX.match(words[-1]):  # "group g", "field k", "cofactor aij" — term+variable
        return None
    return t


def clean_def(raw: str, genus: str | None) -> str | None:
    d = clean_text(raw)
    if genus:                                            # re-attach the "a/an/the" the pattern split off
        d = f'{genus} {d}'
    d = d.rstrip(' ,;:')
    if not (15 <= len(d) <= 260) or looks_artifacted(d):
        return None
    if not d[0].isalpha():
        return None
    if DEF_CONTEXT.search(d):                            # context-dependent ("the path illustrated") → not glossary-grade
        return None
    if d.rstrip()[-1:].islower() and ' ' in d and len(d.split()[-1]) <= 3:  # truncated mid-word tail ("plane reg")
        return None
    return d[0].lower() + d[1:] if not d[:3].isupper() else d


def load_spec_terms(spec_path: str) -> set[str]:
    """Every glossary term + alias already in the spec, lowercased, so we only surface NEW concepts."""
    have: set[str] = set()
    if not spec_path or not os.path.exists(spec_path):
        return have
    spec = json.load(open(spec_path))
    for topic in spec.get('topics', []):
        for g in topic.get('glossary', []):
            for key in ('term', 'alias'):
                v = g.get(key)
                if isinstance(v, str):
                    have.add(v.lower())
    return have


def mine(field: str, brain_dir: str, spec_path: str, min_freq: int, top: int):
    jf = os.path.join(brain_dir, field, f'{field}.jsonl')
    if not os.path.exists(jf):
        sys.exit(f'corpus not found: {jf}')
    have = load_spec_terms(spec_path)

    # term -> {definition -> count}, and term -> set(slugs) for breadth
    defs: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    slugs: dict[str, set[str]] = defaultdict(set)
    chunks = 0
    with open(jf) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            chunks += 1
            text = rec.get('text') or ''
            if '�' in text or '�' in text:
                continue
            slug = rec.get('slug') or ''
            for sent in SENT_SPLIT.split(clean_text(text)):
                if len(sent) < 20 or len(sent) > 400:
                    continue
                for pi, pat in enumerate(PATTERNS):
                    m = pat.match(sent)
                    if not m:
                        continue
                    if pi == 0:                          # genus pattern: groups = term, article, def
                        term_raw, genus, def_raw = m.group(1), m.group(2), m.group(3)
                    else:
                        term_raw, genus, def_raw = m.group(1), None, m.group(2)
                    term = norm_term(term_raw)
                    if not term or term in have:
                        continue
                    d = clean_def(def_raw, genus)
                    if not d:
                        continue
                    defs[term][d] += 1
                    slugs[term].add(slug)
                    break

    # Rank: a term is a candidate if it was defined in >= min_freq DISTINCT materials (breadth = real concept).
    candidates = []
    for term, dmap in defs.items():
        breadth = len(slugs[term])
        if breadth < min_freq:
            continue
        best_def, best_n = max(dmap.items(), key=lambda kv: (kv[1], len(kv[0])))
        candidates.append({
            'term': term,
            'definition': best_def,
            'breadth': breadth,                          # distinct materials that defined it
            'support': best_n,                           # times the chosen definition appeared
            'variants': len(dmap),
        })
    candidates.sort(key=lambda c: (c['breadth'], c['support']), reverse=True)
    return chunks, candidates[:top]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('field')
    ap.add_argument('--brain', default=os.path.expanduser('~/.noetica/brains/academic'))
    ap.add_argument('--spec', default='')
    ap.add_argument('--min-freq', type=int, default=3, help='min distinct materials that must define a term')
    ap.add_argument('--top', type=int, default=200)
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    chunks, cands = mine(a.field, a.brain, a.spec, a.min_freq, a.top)
    print(f'{a.field}: scanned {chunks} chunks → {len(cands)} NEW candidate terms '
          f'(>= {a.min_freq} distinct materials, deduped vs spec)', file=sys.stderr)
    payload = {'field': a.field, 'chunks_scanned': chunks, 'candidates': cands}
    if a.out:
        json.dump(payload, open(a.out, 'w'), indent=2)
        print(f'wrote {a.out}', file=sys.stderr)
    else:
        for c in cands[:40]:
            print(f"  [{c['breadth']:3}m] {c['term']:32} — {c['definition'][:90]}")


if __name__ == '__main__':
    main()
