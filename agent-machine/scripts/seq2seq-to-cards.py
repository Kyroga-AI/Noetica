#!/usr/bin/env python3
"""
seq2seq-to-cards — write the mined (NL↔symbol) pairs BACK into the canon as cards, with ATTRIBUTE-EQUIVALENCE
dedup so they enrich rather than duplicate. Closes the loop: corpus/glossary → seq2seq pairs → cards → canon.

A "card" is a bidirectional unit: front (NL) ↔ back (symbol). The canon's canon[] {name, form} entries are
already cards; the glossary-mined seq2seq pairs are NEW candidate cards. We keep a card only if its formula is
not ATTRIBUTE-EQUIVALENT to one the topic already has (normalized form: operators unified, spacing/case
dropped — so "F = m*a", "F = m a", "F=ma" are one). The surviving new cards then flow into canonFormulas/
canonGround (canon-lookup reads cards.jsonl) and are typed as Formula by canon-to-ontogenesis.

Output: canon/cards.jsonl  {front, back, domain, topic, type, source, dir, norm}.
Run:  python3 scripts/build-seq2seq-pairs.py && python3 scripts/seq2seq-to-cards.py
"""
import os, re, json, glob

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
tkey = lambda d, t: f"{d.strip().lower()}::{(t or '').strip().lower()}"


def normf(s: str) -> str:
    """Attribute-equivalence normal form for a formula: unify operators, drop spacing/case."""
    s = (s or '').lower().replace('×', '*').replace('·', '*').replace('−', '-').replace('–', '-').replace('∗', '*')
    return re.sub(r'\s+', '', s)


def main():
    topics = {}   # "domain::topic" -> {domain, topic, norms:set, cards:[]}
    # 1. seed with the canon's own equations (already cards) — these define what already exists
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            tk = tkey(dom, t.get('topic', ''))
            e = topics.setdefault(tk, {'domain': dom, 'topic': t.get('topic'), 'norms': set(), 'cards': []})
            for c in t.get('canon', []):
                nm, form = c.get('name'), c.get('form')
                if nm and form:
                    n = normf(form)
                    if n in e['norms']:
                        continue
                    e['norms'].add(n)
                    e['cards'].append({'front': nm, 'back': form, 'type': c.get('type', 'equation'), 'source': 'canon', 'norm': n})

    # 2. merge the glossary-mined seq2seq pairs, deduped by attribute-equivalence
    pairs_path = os.path.join(CANON, 'seq2seq-pairs.jsonl')
    added = dup = 0
    if os.path.exists(pairs_path):
        for line in open(pairs_path):
            if not line.strip():
                continue
            p = json.loads(line)
            if p.get('kind') != 'glossary':      # equation-kind cards are already the canon[] above
                continue
            tk = tkey(p.get('domain', ''), p.get('topic', ''))
            e = topics.get(tk)
            if not e:
                continue
            n = normf(p['sym'])
            if n in e['norms']:                   # attribute-equivalent to an existing card → merge (skip)
                dup += 1; continue
            e['norms'].add(n)
            e['cards'].append({'front': p['nl'], 'back': p['sym'], 'type': 'equation', 'source': 'seq2seq', 'norm': n})
            added += 1

    # 3. emit the deck
    deck = []
    for tk, e in topics.items():
        for c in e['cards']:
            deck.append({'front': c['front'], 'back': c['back'], 'domain': e['domain'], 'topic': e['topic'],
                         'type': c['type'], 'source': c['source'], 'dir': 'both', 'norm': c['norm']})
    op = os.path.join(CANON, 'cards.jsonl')
    with open(op, 'w') as fh:
        for c in deck:
            fh.write(json.dumps({k: v for k, v in c.items() if k != 'norm'}, ensure_ascii=False) + '\n')
    canon_n = sum(1 for c in deck if c['source'] == 'canon')
    print(f"# {len(deck)} cards  ({canon_n} canon + {added} NEW from seq2seq)  ·  {dup} attribute-equivalence merges  → {op}")
    print("## NEW cards written back from seq2seq (glossary-mined equations the canon[] lacked):")
    for c in [x for x in deck if x['source'] == 'seq2seq'][:10]:
        print(f"  [{c['domain']}/{c['topic']}]  {c['front'][:48]}…  ↔  {c['back']}")
    print("\n# next: canon-lookup reads cards.jsonl into canonFormulas (mined eqs ground answers); canon-to-ontogenesis types them as Formula.")


if __name__ == '__main__':
    main()
