#!/usr/bin/env python3
"""
lexical-closure — induce the IS-A hierarchy from n-gram structure alone (compositional hyponymy / the
Biperpedia trick): a modifier+head compound is a hyponym of its head. "angular momentum" ⊂ "momentum";
"Pennsylvania customer" ⊂ "customer"; "electric field" ⊂ "field". Zero generation, zero embeddings — pure
string structure, so these edges are DEDUCED (rule-derived, high confidence), not induced or abduced.

For each multi-word canon term, the LONGEST proper suffix that is itself a canon term is its parent (most
specific genus); "moment generating function" → "generating function" → "function". This connects the
entity↔attribute store ACROSS topics (the specific term and its genus often live in different topics) — the
cross-topic / cross-form glue the flat glossary lacked.

Output: canon/lexical-hierarchy.json  {edges:[{child, parent, child_topic, parent_topic, rule, mode}], ...}.
Consumed by canon-to-graph (is_a edges), canon-to-ontogenesis (skos:broader, epistemicMode=deduced), and
canonGround (pull the genus for broader context).
Run:  python3 scripts/lexical-closure.py
"""
import os, re, json, glob
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
norm = lambda s: re.sub(r'\s+', ' ', (s or '').strip().lower())
# function words that shouldn't be treated as a standalone genus head
STOP_HEAD = {'of', 'the', 'a', 'an', 'and', 'in', 'to', 'for', 'with', 'function'}  # 'function' kept only as a longer-suffix genus


def main():
    term_topic = {}    # norm(term) -> (domain, topic, display)
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            for g in t.get('glossary', []):
                term = g.get('term')
                if term:
                    k = norm(term)
                    term_topic.setdefault(k, (dom, t.get('topic'), term))
    terms = set(term_topic)

    edges = []
    seen = set()
    for k in terms:
        words = k.split()
        if len(words) < 2:
            continue
        # longest proper suffix that is itself a term = the most-specific genus
        parent = None
        for i in range(1, len(words)):
            suf = ' '.join(words[i:])
            if suf in terms and suf != k:
                parent = suf; break
        if not parent:
            continue
        if (k, parent) in seen:
            continue
        seen.add((k, parent))
        cd, ct, cdisp = term_topic[k]
        pd, pt, pdisp = term_topic[parent]
        edges.append({'child': cdisp, 'parent': pdisp, 'child_topic': f"{cd}:{ct}", 'parent_topic': f"{pd}:{pt}",
                      'cross_topic': (cd, ct) != (pd, pt), 'rule': 'head-hyponymy', 'mode': 'deduced'})

    op = os.path.join(CANON, 'lexical-hierarchy.json')
    cross = sum(1 for e in edges if e['cross_topic'])
    json.dump({'rule': 'compositional hyponymy (longest suffix-term = genus)', 'mode': 'deduced',
               'n_terms': len(terms), 'n_multi': sum(1 for k in terms if ' ' in k),
               'edges': edges}, open(op, 'w'), indent=1)
    print(f"# {len(edges)} DEDUCED is-a edges (compositional hyponymy) · {cross} cross-topic · → {op}")
    # show the genus fan-out (a general concept gathering its specializations across topics)
    fan = defaultdict(list)
    for e in edges:
        fan[e['parent']].append(e['child'])
    print("## genus → specializations (the cross-topic connective tissue):")
    for parent, kids in sorted(fan.items(), key=lambda x: -len(x[1]))[:8]:
        print(f"  {parent}  ⊃  {', '.join(kids[:6])}{' …' if len(kids) > 6 else ''}")


if __name__ == '__main__':
    main()
