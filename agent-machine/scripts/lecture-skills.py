#!/usr/bin/env python3
"""
lecture-skills — "each lecture is almost a skill." Turn the corpus into the Alexandrian Academy COMPETENCY
GRAPH: every (course, lecture-file) is a skill node; classify it to the topic/subtopic it teaches (using the
frontier-authored specs as the label set) and extract what it teaches (the glossary terms + canon present).

  course ──has──▶ lecture (SKILL) ──teaches──▶ topic ▸ subtopic + glossary terms + canon equations
                                  ──maps-to──▶ MMLU / MMLU-Pro subject

CPU keyword-overlap classification (fast, scalable over thousands of lectures); the specs supply the labels.
Output: canon/skills.json (the skill graph) + a per-domain summary. Frontier subagents can then REVIEW/refine.

Run:  OCW_BRAIN=… python3 scripts/lecture-skills.py [domain ...]
"""
import os, sys, re, json, collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
SPECS = {os.path.basename(f)[5:-5]: json.load(open(os.path.join(HERE, 'canon', f)))
         for f in os.listdir(os.path.join(HERE, 'canon')) if f.startswith('spec-') and f.endswith('.json')}
FIELD_DOMAIN = {'physics': 'physics', 'chemistry': 'chemistry', 'mathematics': 'mathematics',
                'biology': 'biology', 'biological_eng': 'biology', 'eecs': 'computer_science'}
TEACH_MAT = {'lecture', 'reference', 'recitation'}
_w = re.compile(r"[a-z][a-z'-]{2,}")


def topic_index(spec):
    """topic → set of indicator terms (subtopic words + glossary term words)."""
    idx = []
    for t in spec.get('topics', []):
        terms = set()
        for s in t.get('subtopics', []):
            terms.update(_w.findall(s.lower()))
        gl = {}
        for g in t.get('glossary', []):
            term = (g.get('term') or '').lower()
            if term:
                terms.update(_w.findall(term)); gl[term] = 1
        idx.append({'topic': t.get('topic'), 'level': t.get('level'), 'subtopics': t.get('subtopics', []),
                    'terms': terms, 'glossary': set(gl)})
    return idx


def classify(text, idx):
    toks = collections.Counter(_w.findall(text.lower()))
    best, best_s = None, 0
    for t in idx:
        score = sum(toks[w] for w in t['terms'])
        norm = score / (len(t['terms']) or 1)
        if norm > best_s:
            best_s, best = norm, t
    if not best:
        return None
    teaches = sorted([g for g in best['glossary'] if all(w in toks for w in g.split())])[:12]
    return {'topic': best['topic'], 'level': best['level'], 'teaches': teaches, 'score': round(best_s, 2)}


def main():
    fields = sys.argv[1:] or [f for f in sorted(os.listdir(BRAIN)) if f in FIELD_DOMAIN] if os.path.isdir(BRAIN) else []
    graph = {}
    for field in fields:
        dom = FIELD_DOMAIN.get(field)
        if dom not in SPECS:
            continue
        idx = topic_index(SPECS[dom])
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
        topic_dist = collections.Counter(); skilled = 0
        for (slug, file), L in lectures.items():
            txt = ' '.join(L['text'])[:8000]
            if len(txt) < 200:
                continue
            sk = classify(txt, idx)
            if not sk or sk['score'] < 0.05:
                continue
            graph.setdefault(dom, {}).setdefault(slug, {'domain': dom, 'mmlu': SPECS[dom].get('mmlu_subjects', []),
                                                        'mmlu_pro': SPECS[dom].get('mmlu_pro_category'), 'skills': []})
            graph[dom][slug]['skills'].append({'lecture': file, 'topic': sk['topic'], 'level': sk['level'],
                                               'teaches': sk['teaches'], 'material': L['mat']})
            topic_dist[sk['topic']] += 1; skilled += 1
        ncourses = len(graph.get(dom, {}))
        print(f"  {field:16} {skilled:>5} lecture-skills · {ncourses:>3} courses · top topics: "
              + ', '.join(f'{t}({n})' for t, n in topic_dist.most_common(4)))
    os.makedirs(os.path.join(HERE, 'canon'), exist_ok=True)
    json.dump(graph, open(os.path.join(HERE, 'canon', 'skills.json'), 'w'), indent=1, ensure_ascii=False)
    tot = sum(len(c['skills']) for d in graph.values() for c in d.values())
    print(f"\n# {tot} lecture-skills → canon/skills.json  (the Alexandrian Academy competency graph; frontier subagents refine)")


if __name__ == '__main__':
    main()
