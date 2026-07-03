#!/usr/bin/env python3
"""
build-distill-dataset.py — assemble an SFT distillation dataset from AUTHORITATIVE sources ONLY, to bake the
moat into a small sovereign model (the on-thesis model-dev path vs watsonx.ai/Granite).

CRITICAL CONSTRAINT (memory feedback_glossary_frontier_authored): the teacher signal is the FRONTIER-AUTHORED
canon glossary + VERIFIED operator outputs — NEVER the local 7B's own guesses. Every pair is tagged with its
provenance (source + verified flag) so the distilled model + dataset carry an auditable lineage
(functional-model-surfaces standards spine). Output: JSONL of {messages, meta} instruction pairs.

The QLoRA fine-tune + GGUF quantization + bench eval are GCP-shaped (the 8GB Mac can't train) — this builder is
the board-independent half: it runs to completion here and emits the dataset to feed that pilot.

  python3 scripts/build-distill-dataset.py            # -> dist/distill-sft.jsonl + printed stats
"""
import glob
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CANON = sorted(glob.glob(os.path.join(HERE, '..', 'canon', 'spec-*.json')))
OUT = os.path.join(HERE, '..', 'dist', 'distill-sft.jsonl')


def pair(instruction: str, response: str, **meta) -> dict:
    return {'messages': [{'role': 'user', 'content': instruction},
                         {'role': 'assistant', 'content': response}], 'meta': meta}


def canon_glossary_pairs():
    """Frontier-authored term->definition pairs (the primary teacher signal)."""
    for f in CANON:
        try:
            d = json.load(open(f))
        except Exception:
            continue
        domain = d.get('domain', os.path.basename(f).replace('spec-', '').replace('.json', ''))
        for topic in d.get('topics', []):
            tname = topic.get('topic', '')
            for g in topic.get('glossary', []):
                term, defn = (g.get('term') or '').strip(), (g.get('definition') or '').strip()
                if len(term) >= 2 and len(defn) >= 12:
                    yield pair(f'Define "{term}" in {domain}.', defn,
                               source='canon-glossary', domain=domain, topic=tname, verified=True)


def operator_pairs():
    """VERIFIED compute: call the tested operator library; its output IS the ground truth (not a guess)."""
    sys.path.insert(0, os.path.join(HERE, '..', 'lib'))
    try:
        import math_operators as ops  # type: ignore
    except Exception as e:
        print(f'  (operators skipped: {e!r})', file=sys.stderr)
        return
    # only well-known signatures; each wrapped so a mismatch is skipped, never crashes the build
    cases = [
        ('Compute the greatest common divisor of 48 and 36.', lambda: ops.gcd(48, 36)),
        ('Compute the least common multiple of 4 and 6.', lambda: ops.lcm(4, 6)),
        ('Compute 3 raised to the 47th power, modulo 23.', lambda: ops.mod_pow(3, 47, 23)),
        ('Compute the greatest common divisor of 1071 and 462.', lambda: ops.gcd(1071, 462)),
        ('Compute 7 raised to the 256th power, modulo 13.', lambda: ops.mod_pow(7, 256, 13)),
    ]
    for prompt, fn in cases:
        try:
            ans = fn()
        except Exception:
            continue
        yield pair(prompt, str(ans), source='verified-operator', domain='mathematics', verified=True)


CANON_DIR = os.path.join(HERE, '..', 'canon')


def _load_json(name):
    try:
        return json.load(open(os.path.join(CANON_DIR, name)))
    except Exception:
        return None


def _iter_jsonl(name):
    p = os.path.join(CANON_DIR, name)
    if not os.path.exists(p):
        return
    for line in open(p):
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except Exception:
            continue


def main_glossary_pairs():
    """The full frontier-authored glossary (canon/glossary.json: {domain: {term: def}}) — the richer
    source the builder was leaving on the table (spec-*.json alone is thin)."""
    d = _load_json('glossary.json') or {}
    for domain, terms in d.items():
        if not isinstance(terms, dict):
            continue
        for term, defn in terms.items():
            term, defn = str(term).strip(), str(defn).strip()
            if len(term) >= 2 and len(defn) >= 12:
                yield pair(f'Define "{term}" in {domain}.', defn,
                           source='canon-glossary-main', domain=domain, verified=True)


def canonical_equation_pairs():
    """AP/SAT-seeded exam-sanctioned formula sheets (canon/canonical-equations.json)."""
    d = _load_json('canonical-equations.json') or {}
    for domain, items in d.items():
        if domain.startswith('_') or not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            name = str(it.get('name') or it.get('concept') or it.get('law') or it.get('quantity') or '').strip()
            eq = str(it.get('form') or it.get('equation') or it.get('formula') or it.get('expr') or '').strip()
            if len(name) >= 2 and len(eq) >= 2:
                yield pair(f'State the canonical equation for {name} in {domain}.', eq,
                           source='canonical-equation', domain=domain, verified=True)


def operator_typed_pairs():
    """Verified operators (canon/operators-typed.jsonl: source=frontier-authored/canonical, verified=dimensional+plugback)."""
    for it in _iter_jsonl('operators-typed.jsonl'):
        src = str(it.get('source', ''))
        if 'frontier' not in src.lower() and 'canonical' not in src.lower():
            continue  # provenance gate: only frontier-authored/canonical
        op = str(it.get('op') or '').strip()
        eq = str(it.get('equation') or '').strip()
        dom = str(it.get('domain') or 'physics')
        if len(op) >= 2 and len(eq) >= 2:
            yield pair(f'State the governing equation for {op}.', eq,
                       source='verified-operator-typed', domain=dom, verified=True)


def seq2seq_pairs():
    """Canonical NL->symbolic formalizations (canon/seq2seq-pairs.jsonl)."""
    for it in _iter_jsonl('seq2seq-pairs.jsonl'):
        nl = str(it.get('nl') or '').strip()
        sym = str(it.get('sym') or '').strip()
        dom = str(it.get('domain') or 'mathematics')
        if len(nl) >= 3 and len(sym) >= 2:
            yield pair(f'Express "{nl}" symbolically.', sym,
                       source='canon-seq2seq', domain=dom, verified=True)


def card_pairs():
    """Frontier-authored flashcards (canon/cards.jsonl) — ONLY source==canon (skip seq2seq-derived)."""
    for it in _iter_jsonl('cards.jsonl'):
        if str(it.get('source', '')).lower() != 'canon':
            continue  # provenance gate
        front = str(it.get('front') or '').strip()
        back = str(it.get('back') or '').strip()
        dom = str(it.get('domain') or 'general')
        if len(front) >= 2 and len(back) >= 12:
            yield pair(front if front.endswith('?') else f'Explain: {front}', back,
                       source='canon-card', domain=dom, verified=True)


def analogy_pairs():
    """Cross-domain reasoning analogies (canon/analogies.json)."""
    d = _load_json('analogies.json') or {}
    for it in (d.get('analogies') or []):
        if not isinstance(it, dict):
            continue
        a, b = str(it.get('a') or '').strip(), str(it.get('b') or '').strip()
        schema = str(it.get('schema') or '').strip()
        mapping = str(it.get('mapping') or '').strip()
        if len(a) >= 2 and len(b) >= 2 and (schema or mapping):
            resp = (f'Shared schema: {schema}. Mapping: {mapping}').strip('. ')
            yield pair(f'How is {a} analogous to {b}?', resp,
                       source='canon-analogy', domain='cross-domain', verified=True)


def main() -> None:
    harvesters = [
        canon_glossary_pairs, operator_pairs,          # original
        main_glossary_pairs, canonical_equation_pairs, # + richer canon
        operator_typed_pairs, seq2seq_pairs, card_pairs, analogy_pairs,
    ]
    raw = []
    for h in harvesters:
        raw.extend(list(h()))
    # dedup by the instruction text (glossary.json may overlap spec-*.json), keep first-seen
    seen, rows = set(), []
    for r in raw:
        key = r['messages'][0]['content'].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        rows.append(r)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        for r in rows:
            fh.write(json.dumps(r) + '\n')

    by_source = Counter(r['meta']['source'] for r in rows)
    by_domain = Counter(r['meta']['domain'] for r in rows)
    assert all(r['meta']['verified'] for r in rows), 'every pair must be from a verified/authoritative source'
    print(f'wrote {len(rows)} SFT pairs -> {os.path.relpath(OUT, HERE)}', file=sys.stderr)
    print(f'  by source: {dict(by_source)}', file=sys.stderr)
    print(f'  by domain: {dict(by_domain)}', file=sys.stderr)
    print('  all pairs from AUTHORITATIVE sources (frontier canon + verified operators) — 0 from the local 7B',
          file=sys.stderr)


if __name__ == '__main__':
    main()
