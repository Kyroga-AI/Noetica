#!/usr/bin/env python3
"""
grow-canon — RECOVER the equations our extraction mangled; do NOT discard them. MIT's material is the gold
standard — the mangling is our failure, and the unlinked-fragment count is a RECOVERY GAP to close, not noise.

This mines the fragments that did NOT link to the canonical set, finds the real recoverable equations among
them (frequent + parseable), reconstructs each (LLM-repair → name + clean form), VERIFIES it against Wikidata,
and ADDS it to the canon with provenance. Re-linking with the grown canon raises the recovery rate. Iterate.

Per domain: extract candidates → fuzzy-link to canon → UNLINKED, deduped, frequency-ranked → top-K → LLM-repair
→ Wikidata-verify → propose (WRITE=1 adds). Reports recovery rate before → projected after.

Run:  OCW_BRAIN=… python3 scripts/grow-canon.py [domain ...]
  GROW_TOPK   unlinked clusters to attempt (default 25)   GROW_MINFREQ  min recurrence to attempt (default 3)
  GROW_MODEL  ollama model (default qwen2.5:7b)           WRITE=1  add verified equations to canon
"""
import os, sys, re, json, time, collections, importlib.util, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(HERE, 'scripts')


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.argv = [name]                     # keep their __main__ guards from firing on our argv
    spec.loader.exec_module(m)
    return m


cf = _load('cleanformulas', os.path.join(SCRIPTS, 'clean-formulas.py'))   # is_formula, signature, link, field_candidates, canon, CANON
vc = _load('validatecanon', os.path.join(SCRIPTS, 'validate-canon.py'))   # wikidata_formula

TOPK = int(os.environ.get('GROW_TOPK', '25'))
MINFREQ = int(os.environ.get('GROW_MINFREQ', '3'))
MODEL = os.environ.get('GROW_MODEL', 'qwen2.5:7b')
BASE = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434')
WRITE = os.environ.get('WRITE') == '1'


def ollama(prompt):
    body = json.dumps({'model': MODEL, 'messages': [{'role': 'user', 'content': prompt}],
                       'stream': False, 'temperature': 0}).encode()
    req = urllib.request.Request(f'{BASE}/v1/chat/completions', body, {'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())['choices'][0]['message']['content']
    except Exception as e:
        return ''


def parseable(form):
    try:
        import sympy as sp
        from sympy.parsing.sympy_parser import parse_expr
        parse_expr(form.split('=')[-1].replace('^', '**'), evaluate=False)
        return True
    except Exception:
        return False


def main():
    domains = sys.argv[1:] or [d for d in cf.canon if not d.startswith('_')]
    canon = cf.canon
    for dom in domains:
        eqs = canon.get(dom)
        if not eqs:
            continue
        cands = cf.field_candidates(dom)
        unlinked = collections.Counter()
        linked = 0
        for c in cands:
            eq, s = cf.link(c, eqs)
            if eq:
                linked += 1
            else:
                unlinked[re.sub(r'\s+', ' ', c.strip())] += 1
        gap = sum(unlinked.values())
        rate = linked / max(linked + gap, 1)
        # the recovery TARGETS: frequent unlinked fragments (recurrence ⇒ a real recurring equation, not a one-off)
        targets = [frag for frag, n in unlinked.most_common(TOPK * 4) if n >= MINFREQ][:TOPK]
        print(f"\n## {dom}: recovery rate {rate:.1%} ({linked} linked / {gap} gap) · attempting {len(targets)} frequent unlinked")
        if not targets:
            continue
        raw = ollama(
            f"These are frequent formula fragments OCR-extracted (noisily, flattened sub/superscripts) from "
            f"{dom} course materials that did NOT match our formula sheet. For each that is a REAL, standard, "
            f"named {dom} equation, output ONE line exactly: NAME | CLEAN_FORM | TOPIC. Skip data tables, "
            f"fragments, and anything not a canonical equation. Be conservative.\n\n" + "\n".join(f"- {t}" for t in targets))
        recovered = []
        have = {e['name'].lower() for e in eqs}
        for line in raw.splitlines():
            parts = [p.strip() for p in line.split('|')]
            if len(parts) != 3 or not parts[1] or parts[0].lower() in have:
                continue
            name, form, topic = parts
            if not re.search(r'[=∝]', form) or not parseable(form):
                continue
            qid, ref = vc.wikidata_formula(name)        # verify it's a real concept
            time.sleep(0.3)
            if not qid:
                continue
            recovered.append({'id': re.sub(r'[^a-z0-9]+', '_', name.lower())[:24], 'name': name, 'form': form,
                              'topic': topic, 'keywords': [], 'wikidata': qid, 'source': 'OCW-recovered'})
            have.add(name.lower())
            print(f"  + RECOVERED  {name:32} {form:34} [{qid}]")
        proj = (linked + sum(unlinked[t] for t in targets)) / max(linked + gap, 1)  # optimistic re-link bound
        print(f"  → {len(recovered)} verified equations recovered · projected recovery rate up to ~{proj:.1%}")
        if WRITE and recovered:
            canon[dom].extend(recovered)
    if WRITE:
        json.dump(canon, open(cf.CANON, 'w'), indent=2, ensure_ascii=False)
        print(f"\n# canon grown → {cf.CANON} (re-run clean-formulas to re-link + re-measure the gap)")


if __name__ == '__main__':
    main()
