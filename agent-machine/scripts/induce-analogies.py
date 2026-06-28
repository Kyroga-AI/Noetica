#!/usr/bin/env python3
"""
induce-analogies — ANALOGY / relational-transfer induction (Gliozzo et al., IBM — analogy & relational
knowledge). #4 of the IBM-5. Finds cross-domain STRUCTURAL analogies: canonical laws/equations in different
domains that share the same relational FORM, plus the shared schema and the variable mapping. The classic
example is Ohm's law ~ Fourier's law ~ Fick's law — all "flux = conductivity × gradient".

Why this beats the existing cross-domain links: those are EMBEDDING-proximity (lexical/contextual nearness).
An analogy is STRUCTURAL — same relation, different stuff — so it transfers a METHOD across domains. That is
exactly what a student (and the tutor, and a board arm) needs: "this is the same shape as X you already know."

Where it fits the product:
  • HellGraph — ANALOGOUS_TO edges between Formula nodes, carrying the shared schema (a transfer bridge)
  • a board arm — on a hard question, recognize it's structurally analogous to a known pattern → transfer
  • the AI tutor (Feynman persona) — teach the new by mapping it onto the already-understood

Method: gather canonical {name, form, type} per domain (laws/principles/theorems first), present grouped,
the model emits JSON-line analogies. Output: canon/analogies.json.
Run:  OLLAMA_MODEL=qwen2.5:7b-cpu python3 scripts/induce-analogies.py   (frontier model for the real pass)
"""
import os, re, json, glob, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:7b-cpu')
PER_DOMAIN = int(os.environ.get('PER_DOMAIN', '10'))   # law-like anchors presented per domain
norm = lambda s: re.sub(r'\s+', ' ', (s or '').strip().lower())
# analogy-rich types/keywords first: laws/principles/theorems carry relational structure that transfers
LAWLIKE = re.compile(r'\b(law|principle|theorem|equation|relation|rule|identity|conservation|flux|gradient)\b', re.I)


def gen(prompt):
    req = urllib.request.Request(f'{OLLAMA}/api/generate',
        data=json.dumps({'model': MODEL, 'prompt': prompt, 'stream': False, 'options': {'temperature': 0.2}}).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            return json.load(r).get('response', '')
    except Exception:
        return ''


def main():
    # gather canonical laws/equations per domain (name + form), law-like ranked first
    by_dom = {}
    index = {}                                  # norm(name) -> (name, domain)
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        items = []
        for t in spec.get('topics', []):
            for c in t.get('canon', []):
                nm, form = c.get('name'), c.get('form')
                if nm and form:
                    items.append((nm, form))
                    index[norm(nm)] = (nm, dom)
        items.sort(key=lambda nf: 0 if LAWLIKE.search(nf[0] + ' ' + nf[1]) else 1)
        by_dom[dom] = items[:PER_DOMAIN]
    block = '\n'.join(f"[{dom}]\n" + '\n'.join(f"  - {nm}:  {form}" for nm, form in items)
                      for dom, items in by_dom.items() if items)
    print(f"# anchors: {sum(len(v) for v in by_dom.values())} laws/equations across {len(by_dom)} domains", flush=True)

    prompt = (f"Below are canonical laws/equations grouped by domain.\n\n{block}\n\n"
              f"Find CROSS-DOMAIN STRUCTURAL ANALOGIES: two items from DIFFERENT domains that share the same "
              f"relational FORM (e.g. \"flux = conductivity × gradient\" links Ohm/Fourier/Fick). For each, output "
              f"ONE JSON object per line:\n"
              f'{{"a":"<name>","ad":"<domain>","b":"<name>","bd":"<domain>","schema":"<shared abstract form>","map":"<x↔y mapping>"}}\n'
              f"Different domains only. Real structural matches only. No prose.")
    out, seen = [], set()
    for line in gen(prompt).splitlines():
        m = re.search(r'\{.*\}', line)
        if not m:
            continue
        try:
            d = json.loads(m.group(0))
        except Exception:
            continue
        a, ad, b, bd = d.get('a'), d.get('ad'), d.get('b'), d.get('bd')
        if not (a and b and ad and bd) or norm(ad) == norm(bd):
            continue
        key = tuple(sorted([norm(a), norm(b)]))
        if key in seen:
            continue
        seen.add(key)
        out.append({'a': a, 'a_domain': ad, 'b': b, 'b_domain': bd,
                    'schema': d.get('schema', ''), 'mapping': d.get('map', ''),
                    'a_known': norm(a) in index, 'b_known': norm(b) in index})
    op = os.path.join(CANON, 'analogies.json')
    json.dump({'analogies': out}, open(op, 'w'), indent=1)
    print(f"# induced {len(out)} cross-domain analogies · → {op}")
    for an in out[:12]:
        print(f"  {an['a']} [{an['a_domain']}]  ~  {an['b']} [{an['b_domain']}]   ⟦{an['schema']}⟧")
    print("\n# next: canon-to-graph emits ANALOGOUS_TO edges (carrying schema) · sync-knowledge gates it · a board 'analogy' arm transfers the method")


if __name__ == '__main__':
    main()
