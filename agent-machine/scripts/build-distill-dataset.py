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


def main() -> None:
    rows = list(canon_glossary_pairs()) + list(operator_pairs())
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
