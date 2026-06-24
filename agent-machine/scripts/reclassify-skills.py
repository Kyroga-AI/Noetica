#!/usr/bin/env python3
"""
reclassify-skills — fix the competency graph. The keyword-overlap classifier dumped 89% of math into one
topic; this classifies each lecture to its topic by EMBEDDING SIMILARITY (avg word-vector cosine to topic
centroids), which respects meaning, not term-count quirks. Topic centroid = mean vector of (topic label +
subtopics + glossary terms); lecture vector = mean of its text's word vectors; lecture → nearest topic IN
ITS DOMAIN. Output: canon/skills.json (reclassified) + the per-domain topic distribution so we can SEE it's
no longer skewed.

Run:  MODEL=glove-wiki-gigaword-300 OCW_BRAIN=… python3 scripts/reclassify-skills.py [field ...]
"""
import os, sys, re, json, glob, collections
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
MODEL = os.environ.get('MODEL', 'glove-wiki-gigaword-300')
SPECS = {os.path.basename(f)[5:-5]: json.load(open(f))
         for f in glob.glob(os.path.join(HERE, 'canon', 'spec-*.json'))}
FIELD_DOMAIN = {'physics': 'physics', 'chemistry': 'chemistry', 'mathematics': 'mathematics',
                'biology': 'biology', 'biological_eng': 'biology', 'eecs': 'computer_science'}
TEACH_MAT = {'lecture', 'reference', 'recitation'}
_w = re.compile(r"[a-z][a-z'-]{2,}")


def main():
    import gensim.downloader as api
    kv = api.load(MODEL)

    def vec(text):
        vs = [kv[w] for w in _w.findall((text or '').lower()) if w in kv]
        if not vs:
            return None
        v = np.mean(vs, 0); n = np.linalg.norm(v); return v / n if n else None

    # topic centroids per domain
    cents = {}
    for dom, spec in SPECS.items():
        rows = []
        for t in spec.get('topics', []):
            terms = [t.get('topic', '')] + list(t.get('subtopics', [])) + [g.get('term', '') for g in t.get('glossary', [])]
            v = vec(' '.join(terms))
            if v is not None:
                rows.append((t.get('topic'), t.get('level'), v))
        if rows:
            cents[dom] = {'topics': [r[0] for r in rows], 'levels': [r[1] for r in rows],
                          'M': np.vstack([r[2] for r in rows])}

    fields = sys.argv[1:] or [f for f in sorted(os.listdir(BRAIN)) if f in FIELD_DOMAIN] if os.path.isdir(BRAIN) else []
    graph = {}; tot = 0
    for field in fields:
        dom = FIELD_DOMAIN.get(field)
        if dom not in cents:
            continue
        C = cents[dom]
        d = os.path.join(BRAIN, field)
        lectures = collections.defaultdict(lambda: {'text': [], 'level': '', 'mat': ''})
        for fn in os.listdir(d):
            if not fn.endswith('.jsonl'):
                continue
            for ln in open(os.path.join(d, fn), errors='replace'):
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                if o.get('material') not in TEACH_MAT:
                    continue
                key = (o.get('slug', '?'), str(o.get('file', '?')))
                L = lectures[key]; L['text'].append(o.get('text', '')); L['level'] = o.get('level', ''); L['mat'] = o.get('material')
        # course title (from slug) is the topic signal: 8-04-quantum-physics-i-spring-2013 → "quantum physics i"
        def course_title(slug):
            s = re.sub(r'^\d+[a-z]*-', '', slug)
            s = re.sub(r'-(spring|fall|summer|winter|january|iap)?-?\d{4}.*$', '', s)
            return s.replace('-', ' ')
        slug_topic = {}
        def topic_for(slug):
            if slug not in slug_topic:
                v = vec(course_title(slug)); slug_topic[slug] = None
                if v is not None:
                    sims = C['M'] @ v; j = int(np.argmax(sims))
                    if sims[j] >= 0.30:
                        slug_topic[slug] = (C['topics'][j], C['levels'][j], float(sims[j]))
            return slug_topic[slug]
        dist = collections.Counter(); skilled = 0
        for (slug, file), L in lectures.items():
            tp = topic_for(slug)
            if not tp:
                continue
            topic, level, cos = tp
            graph.setdefault(dom, {}).setdefault(slug, {'domain': dom, 'mmlu': SPECS[dom].get('mmlu_subjects', []),
                                                        'mmlu_pro': SPECS[dom].get('mmlu_pro_category'), 'topic': topic, 'skills': []})
            graph[dom][slug]['skills'].append({'lecture': file, 'topic': topic, 'level': level, 'material': L['mat'], 'cos': round(cos, 3)})
            dist[topic] += 1; skilled += 1; tot += 1
        top = ', '.join(f'{t}({n})' for t, n in dist.most_common(4))
        share = (100 * dist.most_common(1)[0][1] / skilled) if skilled else 0
        print(f"  {field:16} {skilled:>5} skills · {len(dist):>2} topics used · top-1 share {share:.0f}% · {top}")
    json.dump(graph, open(os.path.join(HERE, 'canon', 'skills.json'), 'w'), indent=1, ensure_ascii=False)
    print(f"\n# {tot} lecture-skills → canon/skills.json (embedding-classified; lower top-1 share = less skew)")


if __name__ == '__main__':
    main()
