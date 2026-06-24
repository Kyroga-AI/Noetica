#!/usr/bin/env python3
"""
validate-canon — cross-check our canonical equations' SYMBOLS against the authoritative structured reference,
so the formula sheet isn't just my hand-authored approximation. Source: Wikidata's "defining formula" property
(P2534) — the DBpedia-family structured data behind Wikipedia, a LaTeX formula with the canonical symbols.

Per equation: search Wikidata for the concept → its QID → P2534 defining formula (LaTeX) → extract the symbol
set → compare to ours. Reports MATCH / PARTIAL / MISMATCH / no-reference, and the authoritative LaTeX so a
mismatch is fixable. Writes the cross-reference back into the canon (wikidata + ref_formula) as provenance.

Run:  python3 scripts/validate-canon.py [domain ...]   (WRITE=1 to annotate canon with the references)
"""
import os, sys, re, json, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.environ.get('CANON', os.path.join(HERE, 'canon', 'canonical-equations.json'))
WRITE = os.environ.get('WRITE') == '1'
UA = 'Noetica-canon-validate/1.0 (educational)'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def symbols(s):
    """Variable symbols in a (possibly-LaTeX) formula — strip \\commands and operators, keep letters."""
    s = re.sub(r'\\[a-zA-Z]+', ' ', s)              # drop LaTeX commands (\frac, \vec, \Delta, \cdot…)
    s = re.sub(r'[^A-Za-z]', ' ', s)
    return {w for w in s.split() if 1 <= len(w) <= 2 and w.lower() not in ('d', 'is')}


def wikidata_formula(name):
    """Search Wikidata for the concept → return (qid, defining-formula LaTeX) or (None, None)."""
    try:
        q = urllib.parse.quote(name)
        sr = get(f'https://www.wikidata.org/w/api.php?action=wbsearchentities&search={q}&language=en&format=json&limit=3')
        for hit in sr.get('search', []):
            qid = hit['id']
            cl = get(f'https://www.wikidata.org/w/api.php?action=wbgetclaims&entity={qid}&property=P2534&format=json')
            claims = cl.get('claims', {}).get('P2534', [])
            for c in claims:
                val = c.get('mainsnak', {}).get('datavalue', {}).get('value')
                if isinstance(val, str) and val.strip():
                    return qid, val.strip()
        return (sr.get('search', [{}])[0].get('id'), None) if sr.get('search') else (None, None)
    except Exception:
        return None, None


def main():
    canon = json.load(open(CANON))
    domains = sys.argv[1:] or [d for d in canon if not d.startswith('_')]
    n_match = n_partial = n_miss = n_noref = 0
    for dom in domains:
        eqs = canon.get(dom)
        if not eqs:
            continue
        print(f'\n## {dom}')
        for eq in eqs:
            qid, ref = wikidata_formula(eq['name'])
            ours = symbols(eq['form'])
            if not ref:
                print(f'  ?   {eq["name"]:28} (no P2534 reference{" · "+qid if qid else ""})')
                n_noref += 1
            else:
                theirs = symbols(ref)
                shared = ours & theirs
                cov = len(shared) / max(len(theirs), 1)
                tag = 'OK  ' if cov >= 0.7 else ('~   ' if cov >= 0.4 else 'MISS')
                n_match += cov >= 0.7; n_partial += 0.4 <= cov < 0.7; n_miss += cov < 0.4
                print(f'  {tag}{eq["name"]:28} ours={sorted(ours)} ref[{qid}]={sorted(theirs)} {"" if cov>=0.7 else "→ "+ref[:48]}')
                if WRITE:
                    eq['wikidata'] = qid; eq['ref_formula'] = ref
            time.sleep(0.3)
    print(f'\n# symbols vs Wikidata P2534 — OK={n_match} partial={n_partial} mismatch={n_miss} no-ref={n_noref}')
    if WRITE:
        json.dump(canon, open(CANON, 'w'), indent=2, ensure_ascii=False)
        print(f'# annotated canon with wikidata QIDs + reference formulas → {CANON}')


if __name__ == '__main__':
    main()
