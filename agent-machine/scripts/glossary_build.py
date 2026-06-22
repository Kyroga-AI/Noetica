#!/usr/bin/env python3
"""
glossary_build — the canonical concept GLOSSARY per COURSE and DOMAIN, a first-class brain-stack
asset (lookup · retrieval-anchoring · the concept graph · prerequisite ontology). Concepts are
extracted with the no-LLM ensemble, CANONICALIZED (lemma + surface-variant clustering), SALIENCE-
ranked (termhood = frequency × idf × multiword-bonus, so the "key terms" float up, not the noise),
and carry PROVENANCE (count + an example sentence + source course). Sentence-level co-occurrence
keeps relations tight (the 1,100-char chunk over-connects).

World-class roadmap (hooks marked TODO): external entity-LINKING to canonical IDs (Wikidata QID /
UMLS CUI / MeSH / ChEBI / MSC / PhysH) for global dedup+interop · corpus-mined DEFINITIONS (Hearst/
definitional patterns + KB gloss) · domain TYPE schema (GLiNER) · cross-domain BRIDGES · evaluation
vs gold (textbook indices, domain ontologies) · evidence receipts + versioning.

Run:  python3 scripts/glossary_build.py [field] [--per-course 300] [--top 150]
"""
import os, sys, glob, json, re, time
from collections import Counter, defaultdict
import numpy as np

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
FIELD = next((a for a in sys.argv[1:] if not a.startswith('-')), 'biology')
PER_COURSE = int(sys.argv[sys.argv.index('--per-course') + 1]) if '--per-course' in sys.argv else 300
TOP = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 150
OUT = os.path.join(BRAIN, f'{FIELD}.glossary.json')


def load_by_course(field):
    courses = defaultdict(list)
    for fp in glob.glob(os.path.join(BRAIN, field, '*.jsonl')):
        slug = os.path.splitext(os.path.basename(fp))[0]
        for line in open(fp, errors='replace'):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get('text'):
                courses[o.get('slug', slug)].append(o['text'])
    return courses


def first_sentence_with(term, texts):
    pat = re.compile(re.escape(term.split()[-1]), re.I)
    for t in texts:
        for s in re.split(r'(?<=[.!?])\s+', t):
            if pat.search(s) and 20 < len(s) < 240:
                return s.strip()
    return ''


def main():
    t0 = time.time()
    from concept_extract import ConceptExtractor
    cx = ConceptExtractor(keybert=False)          # GLiNER + NLTK + spaCy (KeyBERT off — too slow for full-corpus passes)
    courses = load_by_course(FIELD)
    print(f"# glossary_build · field={FIELD} · {len(courses)} courses · per-course cap={PER_COURSE}\n")

    course_concepts, df = {}, Counter()
    for ci, (course, texts) in enumerate(courses.items()):
        sample = texts[:PER_COURSE]
        try:
            cc = Counter()
            for cs in cx.extract_batch(sample):
                cc.update(cs)
        except Exception as e:
            print(f"  [skip {course}: {e}]"); continue
        course_concepts[course] = (cc, sample)
        for term in cc:
            df[term] += 1
        sys.stderr.write(f"  {ci+1}/{len(courses)} {course}: {len(cc)} concepts ({time.time()-t0:.0f}s)\n")

    N = max(len(course_concepts), 1)
    glossary = {}
    domain_agg = Counter()
    for course, (cc, sample) in course_concepts.items():
        ranked = []
        for term, f in cc.items():
            idf = float(np.log(N / df[term]))                 # rare-across-courses = distinctive to this one
            salience = f * (1 + idf) * (1 + 0.4 * term.count(' '))   # multiword termhood bonus
            ranked.append((round(salience, 2), f, term))
            domain_agg[term] += f
        ranked.sort(reverse=True)
        glossary[course] = [{'term': t, 'count': f, 'salience': s,
                             'example': first_sentence_with(t, sample)} for s, f, t in ranked[:TOP]]

    out = {'field': FIELD, 'courses': len(glossary),
           'domain_top': [{'term': t, 'count': c} for t, c in domain_agg.most_common(TOP)],
           'glossary': glossary}
    json.dump(out, open(OUT, 'w'), indent=1)
    print(f"  wrote {OUT}  ·  {sum(len(v) for v in glossary.values())} course-concept entries  ·  {len(domain_agg)} unique domain concepts")
    # show a sample
    print(f"\n  DOMAIN top-12 ({FIELD}): " + ', '.join(t for t, _ in domain_agg.most_common(12)))
    for course in list(glossary)[:2]:
        print(f"\n  {course} — top key concepts:")
        for e in glossary[course][:8]:
            print(f"    · {e['term']:32} (sal {e['salience']}, ×{e['count']})  e.g. “{e['example'][:70]}…”" if e['example'] else f"    · {e['term']:32} (sal {e['salience']}, ×{e['count']})")
    print(f"\n# done in {time.time()-t0:.0f}s. Next world-class steps: entity-link to Wikidata/UMLS/MSC, mine definitions, type via GLiNER, eval vs textbook indices.")


if __name__ == '__main__':
    main()
