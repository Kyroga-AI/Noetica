#!/usr/bin/env python3
"""
build-seq2seq-pairs — mine the paired (NATURAL-LANGUAGE ↔ SYMBOL) dataset that lets us learn the formalize /
informalize map. "Do we write word problems as word AND symbol, and learn the seq2seq?" — this builds the
training/few-shot pairs to do exactly that, from the CLEAN source first (the frontier-authored canon), before
the noisier corpus worked-solutions (phase 2, after the Marker de-mangle).

Two directions, one dataset:
  • FORMALIZE   (nl → sym): "Newton's second law"            → "F_net = m*a"        (feeds verified-compute)
  • INFORMALIZE (sym → nl): "L = I*ω"                         → "angular momentum…"  (feeds teaching)

Sources mined here:
  1. canon equations  — every topic's canon[] {name, form} is a gold (nl=name, sym=form) pair (766 of them).
  2. glossary defs    — many definitions embed their equation (e.g. "momentum … p = mv"); we split the prose
                        from the formula → (nl=term + prose, sym=formula).

Output: canon/seq2seq-pairs.jsonl  {nl, sym, domain, topic, kind}. Use as retrieval few-shot exemplars for the
autoform/compute formalizer (brain-ground the formalization), and as the seed for a learned NL↔symbol model.
Run:  python3 scripts/build-seq2seq-pairs.py
"""
import os, re, json, glob

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
# an equation-like span: a symbol/word, '=', then a formula body (stop at sentence punctuation). Keep chained
# equalities (a = b = c). Require at least one math operator/symbol so we don't grab prose "X = the thing".
EQ = re.compile(r'([A-Za-zΑ-Ωα-ω_][\w]*(?:\([^)]*\))?\s*=\s*[^.;:]*?[-+*/^√∑∫·×()0-9Α-Ωα-ω][^.;:]*)')
MATHY = re.compile(r'[=+\-*/^√∑∫·×]|\b(sqrt|sum|int|frac|exp|log|sin|cos|pi)\b')


def is_formula(eq: str) -> bool:
    """A real formula vs grabbed prose: the RHS must be symbolic (operator/number, ≤2 english words) or a short
    pure-symbol token — so 'p = mv' and 'L = I*ω' pass but 'Km = higher affinity' and 'reference = 100' don't."""
    if '=' not in eq:
        return False
    rhs = eq.split('=')[-1].strip().strip('()')
    if not rhs:
        return False
    words = re.findall(r'[a-z]{3,}', rhs)
    has_op = bool(re.search(r'[+\-*/^√∑∫·×]', rhs))   # a real operator (not a bare number/unit like "100" or "22")
    return has_op and len(words) <= 3


def split_eq(defn: str):
    """Return (prose_without_equations, [equations]) so the NL side is clean and the SYM side is the formula."""
    eqs = [m.group(1).strip().rstrip(',') for m in EQ.finditer(defn)]
    eqs = [e for e in eqs if is_formula(e) and len(e) <= 80]
    prose = defn
    for e in eqs:
        prose = prose.replace(e, '')
    prose = re.sub(r'\s+', ' ', re.sub(r'[:;,]\s*$', '', prose.replace('()', ''))).strip()
    return prose, eqs


def main():
    pairs = []
    seen = set()
    n_eq = n_gloss = 0
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            topic = t.get('topic')
            # 1. canon equations: name <-> form (the gold pairs)
            for c in t.get('canon', []):
                nm, form = c.get('name'), c.get('form')
                if nm and form and MATHY.search(form) and len(form) <= 120 and len(re.findall(r'[a-z]{3,}', form)) <= 7:   # symbolic/reaction forms — drop prose "forms" in bio/concept topics
                    key = (nm.lower(), form.replace(' ', ''))
                    if key not in seen:
                        seen.add(key)
                        pairs.append({'nl': nm, 'sym': form, 'domain': dom, 'topic': topic, 'kind': 'equation'})
                        n_eq += 1
            # 2. glossary defs that embed a formula
            for g in t.get('glossary', []):
                term, defn = g.get('term'), g.get('definition')
                if not (term and defn):
                    continue
                prose, eqs = split_eq(defn)
                for e in eqs:
                    key = (term.lower(), e.replace(' ', ''))
                    if key in seen:
                        continue
                    seen.add(key)
                    nl = f"{term}: {prose}" if prose else term
                    pairs.append({'nl': nl[:200], 'sym': e, 'domain': dom, 'topic': topic, 'kind': 'glossary'})
                    n_gloss += 1

    op = os.path.join(CANON, 'seq2seq-pairs.jsonl')
    with open(op, 'w') as fh:
        for p in pairs:
            fh.write(json.dumps(p, ensure_ascii=False) + '\n')
    print(f"# {len(pairs)} paired (nl↔sym) examples  ({n_eq} from equations, {n_gloss} from glossary)  → {op}")
    print("## FORMALIZE samples (nl → sym):")
    for p in [x for x in pairs if x['kind'] == 'equation'][:6]:
        print(f"  \"{p['nl']}\"  →  {p['sym']}")
    print("## INFORMALIZE samples (sym → nl, from glossary):")
    for p in [x for x in pairs if x['kind'] == 'glossary'][:6]:
        print(f"  {p['sym']}  →  \"{p['nl'][:70]}…\"")
    print("\n# next: (a) few-shot the autoform/compute formalizer with the nearest pairs (brain-grounded formalization);")
    print("#       (b) phase-2 mine corpus worked-solutions (problem↔working) after the Marker de-mangle;")
    print("#       (c) a 'formalize' board arm that retrieves k nearest nl→sym pairs as exemplars before sympy.")


if __name__ == '__main__':
    main()
