#!/usr/bin/env python3
"""
build-k12-bursar — turn the K-12 foundation graph into walkable BURSAR tracks, the same way build-registrar.py
makes walkable degrees. Two track kinds, both emitted in the registrar schema so the Alexandrian Academy bursar
treats them like any other program:

  • INTEREST tracks — entered at curiosity ("dinosaurs"), the prereq walk forward toward the field(s) it leads
    to, with the canon `up`-links as the bridge from K-12 into the undergrad canon. "Kids get there themselves."
  • FIELD-readiness tracks — for each field, the K-12 nodes that feed it + their prereq closure = "what a child
    needs before the undergrad path to <field> begins."

Compliance: every node carries a bucket (math / language_arts / science / social_studies / …); a track's walk
accumulates bucket COVERAGE → the homeschool portfolio. Pedagogy is just a path-ordering over the same graph.

Output: academy/registrar-k12.json (bursar tracks) + academy/k12-navigator.json (interest → field → path),
and registers K-12 in academy/catalogue.json.
Run:  python3 scripts/build-k12-bursar.py
"""
import os, json, glob

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACAD = os.path.join(HERE, 'academy')


def main():
    found = json.load(open(os.path.join(ACAD, 'k12-foundations.json')))
    subjects = found['subjects']
    # flat node index: id -> {name, grade, prereq, up, bucket, subject}
    nodes = {}
    for subj, blk in subjects.items():
        for n in blk['nodes']:
            nodes[n['id']] = {**n, 'bucket': blk['bucket'], 'subject': subj}

    def closure(nid):
        """prereq-closure of nid, topologically ordered (prereqs first)."""
        out, seen = [], set()
        def visit(x):
            if x in seen or x not in nodes:
                return
            seen.add(x)
            for p in nodes[x].get('prereq', []):
                visit(p)
            out.append(x)
        visit(nid)
        return out

    def walk(entry_ids):
        order, seen = [], set()
        for e in entry_ids:
            for nid in closure(e):
                if nid not in seen:
                    seen.add(nid); order.append(nid)
        return order

    # canon topic -> domain (field), so a node's `up`-link tells us which FIELD it bridges into
    topic2dom = {}
    for f in glob.glob(os.path.join(HERE, 'canon', 'spec-*.json')):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            if t.get('topic'):
                topic2dom[t['topic']] = dom
    bridge_for_field = {}                                      # field -> [node ids whose up-link feeds that field]
    for nid, n in nodes.items():
        fld = topic2dom.get(n.get('up'))
        if fld:
            bridge_for_field.setdefault(fld, []).append(nid)

    tracks, navigator = [], {}

    # ── INTEREST tracks ───────────────────────────────────────────────────────────────────────────────────
    for it in found.get('interests', []):
        bridges = [b for f in it['fields'] for b in bridge_for_field.get(f, [])]   # climb to each field's canon bridge
        path = walk(it['entry'] + bridges)                                          # foundation (entry closure) + the climb
        path_nodes = [nodes[n] for n in path]
        buckets = sorted({nodes[n]['bucket'] for n in path})
        ups = sorted({nodes[n]['up'] for n in path if nodes[n].get('up')})
        # group the requirement nodes by subject (the bursar "requirement groups")
        groups = {}
        for n in path:
            groups.setdefault(nodes[n]['subject'], []).append({'n': n, 'title': nodes[n]['name'], 'grade': nodes[n].get('grade', '')})
        tracks.append({
            'program': f"Interest: {it['interest']} → {' / '.join(it['fields'])}",
            'kind': 'interest', 'domain': 'k12', 'interest': it['interest'], 'fields': it['fields'], 'hook': it.get('hook', ''),
            'requirements': [{'group': s, 'subjects': v} for s, v in groups.items()],
            'compliance': {'buckets_covered': buckets},
            'bridges_into_canon': ups,
        })
        navigator[it['interest']] = {'fields': it['fields'], 'path': [nodes[n]['name'] for n in path],
                                     'buckets': buckets, 'bridges_into_canon': ups, 'hook': it.get('hook', '')}

    # ── FIELD-readiness tracks (the K-12 nodes that bridge UP into each field) ─────────────────────────────
    field_entry = {}
    for nid, n in nodes.items():
        if n.get('up'):
            # the field is the domain whose canon this node feeds; we infer it from the interest fields that share this node
            for it in found.get('interests', []):
                if nid in walk(it['entry']):
                    for f in it['fields']:
                        field_entry.setdefault(f, set()).add(nid)
    for field, entries in sorted(field_entry.items()):
        path = walk(list(entries))
        if not path:
            continue
        buckets = sorted({nodes[n]['bucket'] for n in path})
        ups = sorted({nodes[n]['up'] for n in path if nodes[n].get('up')})
        groups = {}
        for n in path:
            groups.setdefault(nodes[n]['subject'], []).append({'n': n, 'title': nodes[n]['name'], 'grade': nodes[n].get('grade', '')})
        tracks.append({
            'program': f"K-12 readiness → {field}", 'kind': 'field', 'domain': 'k12', 'field': field,
            'requirements': [{'group': s, 'subjects': v} for s, v in groups.items()],
            'compliance': {'buckets_covered': buckets}, 'bridges_into_canon': ups,
        })

    json.dump({'_doc': 'K-12 bursar tracks (interest + field-readiness), registrar schema.', 'tracks': tracks},
              open(os.path.join(ACAD, 'registrar-k12.json'), 'w'), indent=1)
    json.dump(navigator, open(os.path.join(ACAD, 'k12-navigator.json'), 'w'), indent=1)

    # register K-12 in the catalogue (the bursar index)
    cat_path = os.path.join(ACAD, 'catalogue.json')
    cat = json.load(open(cat_path)) if os.path.exists(cat_path) else {}
    cat['k12'] = {'registrar': 'registrar-k12.json', 'navigator': 'k12-navigator.json',
                  'kinds': ['interest', 'field'], 'buckets': found['buckets'],
                  'note': 'Interest-driven, homeschool-compliant, choose-your-own paths walking the prereq graph from curiosity to a field.'}
    json.dump(cat, open(cat_path, 'w'), indent=1)

    print(f"# {len(tracks)} K-12 bursar tracks ({sum(1 for t in tracks if t['kind']=='interest')} interest + {sum(1 for t in tracks if t['kind']=='field')} field) → academy/registrar-k12.json")
    print("# registered K-12 in academy/catalogue.json")
    print("\n## sample interest walks (curiosity → field → path → compliance):")
    for it in list(navigator)[:4]:
        d = navigator[it]
        print(f"  ▸ {it}  →  {', '.join(d['fields'])}")
        print(f"      path: {' → '.join(d['path'])}")
        print(f"      covers buckets: {', '.join(d['buckets'])}   bridges into canon: {', '.join(d['bridges_into_canon']) or '(K-12 only)'}")


if __name__ == '__main__':
    main()
