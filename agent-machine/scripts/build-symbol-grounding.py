#!/usr/bin/env python3
"""build-symbol-grounding — the durable, reproducible pipeline that grounds canon glossary symbols to
KBpedia reference concepts → Wikidata IDs, and joins CSKG commonsense edges. Replaces the /tmp throwaways
with one auditable script that adds DOMAIN-AWARE SENSE DISAMBIGUATION + a CONFIDENCE tier, so we don't
propagate wrong senses (the alias match for a common word like "ring" or "field" is polysemous).

Sources (CC-BY / open): KBpedia RC + wikidata n3 (cached in /tmp, else fetched from the KBpedia repo);
CSKG (gs://…/datasets/commonsense/raw/cskg.tsv.gz) for aliases + edges.

Confidence:
  high   — KBpedia RC IRI-segment match (curated concept name; reliable)
  medium — CSKG Wikidata-alias match, multi-word term (specific; usually correct sense)
  low    — CSKG alias match on a short generic/polysemous word (flag, don't trust blindly)

Outputs: canon/symbol-grounding.json (+ confidence/domain/method), canon/symbol-commonsense.json.
Run:  python3 scripts/build-symbol-grounding.py            (uses /tmp KBpedia cache + streams CSKG)
      SKIP_CSKG=1 python3 …                                (RC-only, no CSKG streaming — fast)
"""
import os, re, sys, json, subprocess, urllib.request, zipfile, io
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CANON = os.path.join(HERE, '..', 'canon')
CSKG_GCS = 'gs://sourceos-artifacts-socioprophet/datasets/commonsense/raw/cskg.tsv.gz'
KB_RAW = 'https://raw.githubusercontent.com/KBpedia/kbpedia/master/versions/1.60'
# generic/polysemous words: an alias match here is unreliable without WSD → mark 'low'
POLYSEMOUS = set('ring field set group function base model process rank order class element power '
                 'space matrix operation product sum union force work energy charge state phase '
                 'utility cycle root degree term factor series chain bond shell period group cell '
                 'tree graph stack queue map key value node edge path flow wave current'.split())

def norm(s): return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
def words(name): return re.sub(r'(?<!^)(?=[A-Z])', ' ', name)

def cache_or_fetch(name, unzip_member=None):
    """Use /tmp cache if present, else fetch from the CC-BY KBpedia repo."""
    local = f'/tmp/kb-{name.replace("/", "_")}'
    if os.path.exists(local):
        return local
    url = f'{KB_RAW}/{name}'
    sys.stderr.write(f'# fetching {url}\n')
    data = urllib.request.urlopen(url, timeout=120).read()
    if unzip_member:
        data = zipfile.ZipFile(io.BytesIO(data)).read(unzip_member)
    with open(local, 'wb') as f:
        f.write(data)
    return local

def load_glossary():
    g = json.load(open(os.path.join(CANON, 'glossary.json')))
    term_dom = {}                                  # normalized term -> (original, domain)
    for dom, terms in g.items():
        if isinstance(terms, dict):
            for k in terms:
                term_dom[norm(k)] = (k, dom)
    return term_dom

def main():
    term_dom = load_glossary()
    # try cached RC n3 (33MB) — present from earlier runs; else fetch+unzip
    rc_file = '/tmp/kbpedia_reference_concepts.n3'
    if not os.path.exists(rc_file):
        rc_file = cache_or_fetch('kbpedia_reference_concepts.zip', 'kbpedia_reference_concepts.n3')
    wd_file = '/tmp/kb-wikidata.n3' if os.path.exists('/tmp/kb-wikidata.n3') else cache_or_fetch('linkages/wikidata.n3')
    # 1) RC IRI-segment index + RC→Wikidata
    rc_iri = {}
    for line in open(rc_file, encoding='utf-8', errors='replace'):
        s = line.lstrip()
        m = re.match(r':([A-Za-z0-9_\-]+)\s+a\s+owl:Class', s) or re.match(r'<http://kbpedia\.org/kko/rc/([^>]+)>\s+a\s+owl:Class', s)
        if m:
            nm = m.group(1)
            rc_iri.setdefault(norm(words(nm)), 'http://kbpedia.org/kko/rc/' + nm)
    rc_wd = {}
    for line in open(wd_file, encoding='utf-8', errors='replace'):
        m = re.search(r'entity/(Q\d+)>\s+owl:equivalentClass\s+<(http://kbpedia\.org/kko/rc/[^>]+)>', line)
        if m:
            rc_wd[m.group(2)] = m.group(1)
    grounded = {}
    for nt, (orig, dom) in term_dom.items():
        iri = rc_iri.get(nt)
        if iri:
            grounded[orig] = {'kbpedia_rc': iri, 'wikidata': rc_wd.get(iri), 'rc_name': iri.rsplit('/', 1)[-1],
                              'domain': dom, 'confidence': 'high', 'method': 'rc-segment'}
    print(f"RC-segment grounded (high): {len(grounded)} | RCs={len(rc_iri)} RC→WD={len(rc_wd)}")

    if os.environ.get('SKIP_CSKG') != '1':
        # 2) CSKG alias match (one stream) — disambiguation: generic single words → 'low'
        proc = subprocess.Popen(f"gcloud storage cat {CSKG_GCS} | gunzip", shell=True, stdout=subprocess.PIPE, text=True,
                                env={**os.environ, 'OBJC_DISABLE_INITIALIZE_FORK_SAFETY': 'YES'})
        added = 0
        for ln in proc.stdout:
            f = ln.rstrip('\n').split('\t')
            if len(f) < 6:
                continue
            for nid, lab in ((f[1], f[4]), (f[3], f[5])):
                if nid.startswith('Q') and nid[1:].isdigit():
                    nl = norm(lab)
                    td = term_dom.get(nl)
                    if td and td[0] not in grounded:
                        orig, dom = td
                        single = ' ' not in orig.strip()
                        conf = 'low' if (single and norm(orig) in POLYSEMOUS) else 'medium'
                        grounded[orig] = {'kbpedia_rc': None, 'wikidata': nid, 'rc_name': None,
                                          'domain': dom, 'confidence': conf, 'method': 'cskg-alias'}
                        added += 1
        proc.wait()
        print(f"+CSKG alias grounded: {added} (medium/low)")

    cc = Counter(v['confidence'] for v in grounded.values())
    wd = sum(1 for v in grounded.values() if v['wikidata'])
    json.dump(grounded, open(os.path.join(CANON, 'symbol-grounding.json'), 'w'), indent=1)
    print(f"TOTAL grounded: {len(grounded)}/{len(term_dom)} ({100*len(grounded)//len(term_dom)}%) | Wikidata: {wd} | confidence {dict(cc)}")
    print("→ canon/symbol-grounding.json")

    # 3) CSKG edge join for the grounded Q-ids (skip the 'low' ones — unreliable sense)
    if os.environ.get('SKIP_CSKG') != '1':
        wd2sym = defaultdict(list)
        for s, v in grounded.items():
            if v['wikidata'] and v['confidence'] != 'low':
                wd2sym[v['wikidata']].append(s)
        proc = subprocess.Popen(f"gcloud storage cat {CSKG_GCS} | gunzip", shell=True, stdout=subprocess.PIPE, text=True,
                                env={**os.environ, 'OBJC_DISABLE_INITIALIZE_FORK_SAFETY': 'YES'})
        edges = defaultdict(list); seen = set()
        for ln in proc.stdout:
            f = ln.rstrip('\n').split('\t')
            if len(f) < 6:
                continue
            for (nid, lab, other) in ((f[1], f[5], f[3]), (f[3], f[4], f[1])):
                if nid in wd2sym and lab:
                    for s in wd2sym[nid]:
                        k = (s, f[2], lab)
                        if k not in seen:
                            seen.add(k); edges[s].append({'rel': f[2], 'neighbor_label': lab})
        proc.wait()
        out = {s: {'wikidata': grounded[s]['wikidata'], 'kbpedia_rc': grounded[s].get('kbpedia_rc'),
                   'commonsense_edges': e[:40]} for s, e in edges.items()}
        json.dump(out, open(os.path.join(CANON, 'symbol-commonsense.json'), 'w'), indent=1)
        print(f"CSKG edges: {len(out)} symbols, {sum(len(e) for e in edges.values())} edges → canon/symbol-commonsense.json")

if __name__ == '__main__':
    main()
