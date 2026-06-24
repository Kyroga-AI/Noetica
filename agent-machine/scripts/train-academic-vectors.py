#!/usr/bin/env python3
"""
train-academic-vectors — build OUR OWN purely-academic word vectors from the OCW corpus, organized BY COURSE.
Every public embedding (GloVe/fastText/Numberbatch/word2vec) is trained on news/web/crawl; this is the only
one trained on a PURELY ACADEMIC corpus (MIT OCW courseware). The course is the academic unit of sense,
provenance, and competency — so we partition and tag by course.

Construction (sound + course-native):
  • GLOBAL backbone — fastText (subword) over the whole OCW STEM corpus → robust vectors even for rare
    technical terms (eigenstate, homomorphism) via character n-grams. The shared foundation.
  • PER-COURSE — corpus partitioned by course (slug); each course gets a course-VECTOR (centroid of its
    content) so courses are comparable. Course-conditioned term SENSE (operator in 8.04 ≠ 18.06) = v2:
    fine-tune the backbone per course (continued training) from this same partition.
Subword backbone (not per-course-from-scratch) because one course is too small for robust standalone vectors.

Output: ~/.noetica/vectors/ocw-academic.kv (backbone) + ocw-academic-courses.json (course vectors + sizes).
Run:  python3 scripts/train-academic-vectors.py
Env:  EPOCHS(4) DIM(300) MIN_COUNT(5) MAX_CHUNKS(0=all) FIELDS(stem)
"""
import os, re, json, glob
from collections import defaultdict, Counter
import numpy as np

HOME = os.path.expanduser('~')
BRAIN = os.environ.get('OCW_BRAIN', os.path.join(HOME, 'Downloads', 'MIT OCW', '_brain'))
OUT = os.path.join(HOME, '.noetica', 'vectors'); os.makedirs(OUT, exist_ok=True)
FIELDS = os.environ.get('FIELDS', 'physics,mathematics,chemistry,biology,eecs,biological_eng,earth_planetary').split(',')
EPOCHS = int(os.environ.get('EPOCHS', '4')); DIM = int(os.environ.get('DIM', '300'))
MIN_COUNT = int(os.environ.get('MIN_COUNT', '5')); MAX_CHUNKS = int(os.environ.get('MAX_CHUNKS', '0'))
_tok = re.compile(r"[a-z][a-z0-9'+-]*")
COURSE_VOCAB_CAP = 400        # per-course top terms kept for the centroid


def main():
    corpus_file = os.path.join(OUT, '_academic_corpus.txt')
    course_terms = defaultdict(Counter)    # course slug -> token counts (for per-course centroids)
    n = kept = 0
    with open(corpus_file, 'w') as out:
        for field in FIELDS:
            d = os.path.join(BRAIN, field)
            if not os.path.isdir(d):
                continue
            for fn in glob.glob(os.path.join(d, '*.jsonl')):
                for ln in open(fn, errors='replace'):
                    try:
                        o = json.loads(ln)
                    except Exception:
                        continue
                    n += 1
                    t = o.get('text', '')
                    if len(t) < 40 or t.count('�') / max(1, len(t)) > 0.02:
                        continue                       # drop heavily-mangled chunks
                    toks = _tok.findall(t.lower())
                    if len(toks) < 8:
                        continue
                    out.write(' '.join(toks) + '\n')
                    course = o.get('source') or o.get('slug', '?')
                    course_terms[course].update(toks)
                    kept += 1
                    if MAX_CHUNKS and kept >= MAX_CHUNKS:
                        break
                if MAX_CHUNKS and kept >= MAX_CHUNKS:
                    break
            if MAX_CHUNKS and kept >= MAX_CHUNKS:
                break
    print(f"# corpus: {kept}/{n} chunks · {len(course_terms)} courses → {corpus_file}", flush=True)

    from gensim.models import FastText
    print(f"# training fastText academic backbone (sg, dim={DIM}, epochs={EPOCHS}, subword 3–6) — this takes a while ...", flush=True)
    model = FastText(corpus_file=corpus_file, vector_size=DIM, window=5, min_count=MIN_COUNT,
                     sg=1, min_n=3, max_n=6, epochs=EPOCHS, workers=os.cpu_count() or 4)
    kv = model.wv
    kv.save(os.path.join(OUT, 'ocw-academic.kv'))
    print(f"# backbone vocab={len(kv):,} → {OUT}/ocw-academic.kv", flush=True)

    # academic quality check — neighbours of technical terms public (news) vectors fumble
    print("## academic neighbours (proof the corpus is the subject matter):")
    for term in ['eigenstate', 'homomorphism', 'entropy', 'torque', 'manifold', 'enzyme', 'eigenvalue', 'hamiltonian']:
        if term in kv:
            print(f"  {term:13} → {', '.join(w for w, _ in kv.most_similar(term, topn=6))}")

    # per-course vectors: centroid of the course's top terms (course-to-course comparison)
    courses = {}
    cvecs, cnames = [], []
    for slug, cnt in course_terms.items():
        vs = [kv[w] for w, _ in cnt.most_common(COURSE_VOCAB_CAP) if w in kv]
        if len(vs) < 20:
            continue
        v = np.mean(vs, 0); v = v / (np.linalg.norm(v) or 1)
        courses[slug] = {'chunks': sum(cnt.values()) and int(len([1])), 'terms': len(cnt), 'vec': [round(float(x), 4) for x in v]}
        cvecs.append(v); cnames.append(slug)
    json.dump({'dim': DIM, 'courses': courses}, open(os.path.join(OUT, 'ocw-academic-courses.json'), 'w'))
    print(f"# {len(courses)} course-vectors → ocw-academic-courses.json")

    # show a few course-to-course neighbours (does the academic space know which courses are related?)
    if len(cvecs) > 5:
        M = np.vstack(cvecs)
        print("## nearest courses (course-space sanity):")
        for probe in range(min(3, len(cnames))):
            sims = M @ M[probe]; sims[probe] = -9
            j = int(np.argmax(sims))
            print(f"  {cnames[probe][:42]:44} ~ {cnames[j][:42]} ({sims[j]:.2f})")
    print("# DONE — ocw-academic.kv is the purely-academic lens; add it to corpus-atlas (LENSES=...,academic).")


if __name__ == '__main__':
    main()
