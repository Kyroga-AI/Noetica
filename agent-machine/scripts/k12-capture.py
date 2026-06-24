#!/usr/bin/env python3
"""
k12-capture — interest-first, license-aware K-12 content capture (the K-12 analog of ocw-resource-capture.py).
Reads academy/k12-sources.json + k12-foundations.json + k12-navigator.json and:

  1. PLAN — for the priority interests, the entry nodes → which open sources supply each node's subject,
     split clean (public-domain / CC-BY → open brain) vs SEGMENTED (CC-BY-NC → non-commercial commons).
  2. CAPTURE — runs the Project Gutenberg adapter (public-domain, no key) to actually pull the seed texts and
     map them to language-arts nodes, license-tagged. Other source adapters (OpenStax/PhET/IM/CK-12) are
     stubbed with their method + node mapping, ready to fill the same way.

Output: academy/k12-capture-plan.json (committed) + _k12_capture/ (the pulled content + manifest, gitignored,
GCS-bound like the OCW corpus). Captured items carry {license, segment} so segmented (NC) content never enters
a commercial brain.
Run:  python3 scripts/k12-capture.py
"""
import os, re, json, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACAD = os.path.join(HERE, 'academy')
CAPTURE = os.environ.get('K12_CAPTURE_DIR', os.path.join(HERE, '_k12_capture'))
UA = {'User-Agent': 'Mozilla/5.0 (NoeticaKnowledgeCommons/1.0; educational capture)'}
slug = lambda s: re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')[:50]


def load():
    sources = json.load(open(os.path.join(ACAD, 'k12-sources.json')))
    found = json.load(open(os.path.join(ACAD, 'k12-foundations.json')))
    node_subj, node_name = {}, {}
    for subj, blk in found['subjects'].items():
        for n in blk['nodes']:
            node_subj[n['id']] = subj; node_name[n['id']] = n['name']
    return sources, found, node_subj, node_name


def build_plan(sources, found, node_subj, node_name):
    src_by_subj = {}
    for s in sources['sources']:
        for c in s['covers']:
            src_by_subj.setdefault(c, []).append(s)
    entry_of = {it['interest']: it['entry'] for it in found.get('interests', [])}
    plan = []
    for interest in sources.get('priority_interests', []):
        for nid in entry_of.get(interest, []):
            subj = node_subj.get(nid)
            srcs = src_by_subj.get(subj, [])
            plan.append({
                'interest': interest, 'node': nid, 'node_name': node_name.get(nid), 'subject': subj,
                'open_sources': [s['name'] for s in srcs if not s.get('segment')],
                'segmented_sources': [s['name'] for s in srcs if s.get('segment')],
            })
    return plan


def gutenberg_capture(seed):
    """Pull public-domain texts via the gutendex JSON API → text mirror. Returns captured manifest entries."""
    out = os.path.join(CAPTURE, 'gutenberg'); os.makedirs(out, exist_ok=True)
    captured = []
    ids = ','.join(str(s['id']) for s in seed)
    try:
        req = urllib.request.Request(f'https://gutendex.com/books?ids={ids}', headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            books = {b['id']: b for b in json.load(r).get('results', [])}
    except Exception as e:
        print(f"  ! gutendex unreachable ({type(e).__name__}) — plan stands, capture deferred"); return captured
    by_id = {s['id']: s for s in seed}
    for bid, b in books.items():
        fmt = next((u for k, u in b.get('formats', {}).items() if k.startswith('text/plain')), None)
        if not fmt:
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(fmt, headers=UA), timeout=30) as r:
                text = r.read().decode('utf-8', 'ignore')
        except Exception as e:
            print(f"  ! fetch failed {bid}: {type(e).__name__}"); continue
        if len(text) < 500:
            continue
        fn = os.path.join(out, f"{bid}-{slug(b.get('title',''))}.txt")
        open(fn, 'w').write(text)
        captured.append({'source': 'Project Gutenberg', 'license': 'public-domain', 'segment': False,
                         'gutenberg_id': bid, 'title': b.get('title'), 'node': by_id.get(bid, {}).get('node'),
                         'chars': len(text), 'path': os.path.relpath(fn, HERE)})
        print(f"  ✓ {b.get('title')[:46]:46}  → node {by_id.get(bid,{}).get('node')}  ({len(text)//1000}k chars)")
    return captured


def main():
    sources, found, node_subj, node_name = load()
    plan = build_plan(sources, found, node_subj, node_name)
    json.dump({'_doc': 'interest-first K-12 capture plan (which node ← which open sources)', 'plan': plan},
              open(os.path.join(ACAD, 'k12-capture-plan.json'), 'w'), indent=1)
    print(f"# capture PLAN: {len(plan)} (interest,node) targets across {len(sources['priority_interests'])} priority interests → academy/k12-capture-plan.json")
    for p in plan[:6]:
        seg = f"  [+segmented: {', '.join(p['segmented_sources'])}]" if p['segmented_sources'] else ''
        print(f"  {p['interest']:20} · {p['node_name']:34} ← {', '.join(p['open_sources']) or '(needs a source)'}{seg}")

    print("\n# CAPTURE — Project Gutenberg (public-domain, the literature/ELA nodes):")
    captured = gutenberg_capture(sources.get('gutenberg_seed', []))
    if captured:
        os.makedirs(CAPTURE, exist_ok=True)
        json.dump({'captured': captured}, open(os.path.join(CAPTURE, 'manifest.json'), 'w'), indent=1)
        print(f"\n# captured {len(captured)} public-domain texts → _k12_capture/ (license-tagged, GCS-bound). "
              f"Next adapters: OpenStax (CC-BY), Illustrative Math (CC-BY), CK-12 (segment).")


if __name__ == '__main__':
    main()
