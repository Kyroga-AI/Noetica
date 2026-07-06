#!/usr/bin/env python3
"""
derive_topics — derive the 22 canonical domain topics (Intent Algebra rows) LATENTLY from
the MIT-OCW corpus, via the three spaces of the construct:

  LSA  (closed)            SVD on log term-frequency      — deterministic orthonormal basis
  LSI  (bridge/meromorphic) SVD on tf-idf                  — the IR query↔doc bridge
  LDA  (open)              Dirichlet generative topics    — open distributions over the vocab

The topics are corpora-dependent — they are NOT a fixed list; they fall out of OUR corpus.
Each course is one document (title + readings/transcripts). Output: 22 topics per space,
labelled by top terms + the department they load on, so the rows can be named and reconciled.

Run:  python3 scripts/derive_topics.py [--k 22]
"""
import os, re, glob, sys
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.decomposition import TruncatedSVD, LatentDirichletAllocation

K = int(next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--k'), 22))
CORPUS = os.path.expanduser('~/Downloads/MIT OCW/_corpus')
PDFCACHE = os.path.expanduser('~/Downloads/MIT OCW/_pdftext')
PER_FILE = 8000
PER_COURSE = 30000
TS = re.compile(r'\d\d:\d\d|\d\s*-->\s*\d|WEBVTT|^\d+\s*$')
DEPT = re.compile(r'^([a-z]*\d+)')

STOP = set('''mit ocw course courses lecture lectures note notes problem problems set sets exam
exams quiz solution solutions assignment assignments reading readings session sessions fall spring
summer iap pdf http https www edu copyright license creative commons use used using terms also may
one two three see fig figure table chapter section unit page pages student students class
material materials syllabus instructor professor home download video videos image images'''.split())


def dept(slug):
    m = DEPT.match(slug)
    return m.group(1) if m else '?'


def course_doc(d):
    """title + PDF reading content (priority) + text files; transcripts only top up
    courses that lack extracted readings."""
    slug = os.path.basename(d.rstrip('/'))
    title = re.sub(r'-(fall|spring|summer|january|iap)-\d{4}$', '', slug).replace('-', ' ')
    parts = [title + ' '] * 3                      # weight the title
    total = 0
    cpath = os.path.join(PDFCACHE, slug + '.txt')  # substantive layer, if extracted
    if os.path.exists(cpath):
        pdf = open(cpath, encoding='utf-8', errors='ignore').read(PER_COURSE)
        parts.append(pdf); total += len(pdf)
    exts = ('.txt', '.md') if total > 4000 else ('.txt', '.md', '.vtt', '.srt')
    for f in sorted(glob.glob(d + '/**/*', recursive=True)):
        if total >= PER_COURSE or not f.lower().endswith(exts):
            continue
        try:
            t = open(f, encoding='utf-8', errors='ignore').read(PER_FILE)
        except Exception:
            continue
        t = '\n'.join(l for l in t.splitlines() if not TS.search(l))   # strip transcript timecodes
        parts.append(t); total += len(t)
    return slug, ' '.join(parts)


def top_terms(row, vocab, n=9):
    idx = np.argsort(row)[::-1][:n]
    return ', '.join(vocab[i] for i in idx if row[i] > 0)


def main():
    docs, slugs, depts = [], [], []
    for d in sorted(glob.glob(CORPUS + '/*/')):
        slug, doc = course_doc(d)
        if len(doc) > 200:
            docs.append(doc); slugs.append(slug); depts.append(dept(slug))
    print(f"# derive_topics — {len(docs)} course-documents · k={K} topics/space\n")

    stop = list(STOP) + ['the', 'and', 'for', 'with', 'this', 'that', 'are', 'from', 'how']
    cv = CountVectorizer(stop_words=stop, token_pattern=r'[A-Za-z][A-Za-z]{2,}',
                         min_df=5, max_df=0.4, max_features=20000)
    X = cv.fit_transform(docs)
    vocab = np.array(cv.get_feature_names_out())
    tfidf = TfidfVectorizer(vocabulary=cv.vocabulary_, token_pattern=r'[A-Za-z][A-Za-z]{2,}').fit_transform(docs)
    deps = np.array(depts)

    def dominant_dept(doc_loadings):
        """which dept loads highest on this topic (for naming the row)."""
        order = np.argsort(doc_loadings)[::-1][:25]
        vals, cnts = np.unique(deps[order], return_counts=True)
        return vals[np.argmax(cnts)]

    def report(name, term_topics, doc_topics):
        print(f"\n## {name}")
        for t in range(K):
            print(f"  t{t:02d} [dept {dominant_dept(doc_topics[:, t]):>4}]  {top_terms(term_topics[t], vocab)}")

    # LSA (closed) — SVD on log term-frequency
    Xlog = X.copy().astype(float); Xlog.data = np.log1p(Xlog.data)
    lsa = TruncatedSVD(K, random_state=0); D_lsa = lsa.fit_transform(Xlog)
    report('LSA · closed space (SVD on log-TF)', lsa.components_, D_lsa)

    # LSI (bridge) — SVD on tf-idf
    lsi = TruncatedSVD(K, random_state=0); D_lsi = lsi.fit_transform(tfidf)
    report('LSI · bridge / meromorphic space (SVD on tf-idf)', lsi.components_, D_lsi)

    # LDA (open) — generative Dirichlet topics
    lda = LatentDirichletAllocation(K, random_state=0, learning_method='batch', max_iter=20)
    D_lda = lda.fit_transform(X)
    report('LDA · open space (Dirichlet topics)', lda.components_, D_lda)


if __name__ == '__main__':
    main()
