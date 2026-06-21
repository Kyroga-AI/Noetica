#!/usr/bin/env python3
"""
reconcile_topics — denoise the three latent spaces and reconcile them into the canonical 22.

Derives LSA (closed) / LSI (bridge) / LDA (open) topics on the MIT-OCW corpus, then clusters
all 3×K topics together: a cluster spanning all three spaces is a ROBUST canonical row; one in
only a single space is method-specific and tagged as such. The canonical 22 = the best-supported,
most-coherent clusters — each named by consensus terms, with its space-provenance and the
department it loads on (size-normalised, so EECS's bulk doesn't dominate).

Run:  python3 scripts/reconcile_topics.py
"""
import glob
import numpy as np
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer, ENGLISH_STOP_WORDS
from sklearn.decomposition import TruncatedSVD, LatentDirichletAllocation
from sklearn.cluster import AgglomerativeClustering
from derive_topics import course_doc, dept, CORPUS, STOP

K = 22
# spoken-lecture filler that hijacked LSA/LDA — remove it
SPOKEN = set('''just now right out let very actually yeah audience inaudible something thing things
would could said say know talk talked today okay well lot really kind sort going want need think
look looked back down big little put take much good way get got make made does did done come came
able sure maybe guess mean means another around because been before being both during each either
else even ever every few find first give given goes hand help here high keep last later least left
less long most move must never once only other over part place same says seen since small some
still such tell than then there these they this those through time today told too took under until
upon used uses want ways went were what when where which while who whole whose why will within
without work year years your you our their them his her she had has have was are were also like
number set point case different example given problems following find consider show
opencourseware donation visit resources educational hundreds provided support free offer quality
continue recitations outcomes minutes janet trip pair people license commons creative available
high quality teaching learn help others around world make material'''.split())


def main():
    docs, slugs, depts = [], [], []
    for d in sorted(glob.glob(CORPUS + '/*/')):
        slug, doc = course_doc(d)
        if len(doc) > 200:
            docs.append(doc); slugs.append(slug); depts.append(dept(slug))
    depts = np.array(depts)
    uniq_depts = sorted(set(depts))
    stop = list(ENGLISH_STOP_WORDS | STOP | SPOKEN)
    print(f"# reconcile_topics — {len(docs)} docs · {K} topics × 3 spaces → canonical {K}\n")

    cv = CountVectorizer(stop_words=stop, token_pattern=r'[A-Za-z][A-Za-z]{3,}',
                         min_df=8, max_df=0.30, max_features=15000)
    X = cv.fit_transform(docs)
    vocab = np.array(cv.get_feature_names_out())
    tfidf = TfidfVectorizer(vocabulary=cv.vocabulary_, token_pattern=r'[A-Za-z][A-Za-z]{3,}').fit_transform(docs)

    spaces = {}
    Xlog = X.copy().astype(float); Xlog.data = np.log1p(Xlog.data)
    lsa = TruncatedSVD(K, random_state=0); Dlsa = lsa.fit_transform(Xlog); spaces['closed'] = (lsa.components_, Dlsa)
    lsi = TruncatedSVD(K, random_state=0); Dlsi = lsi.fit_transform(tfidf); spaces['bridge'] = (lsi.components_, Dlsi)
    lda = LatentDirichletAllocation(K, random_state=0, learning_method='batch', max_iter=20)
    Dlda = lda.fit_transform(X); spaces['open'] = (lda.components_, Dlda)

    # stack all 3K topics: term-vector (clipped +, L2) + provenance + dominant dept
    rows, meta = [], []
    for space, (comp, D) in spaces.items():
        Dn = D - D.min(0)                          # nonneg doc loadings for dept attribution
        for t in range(K):
            v = np.clip(comp[t], 0, None); n = np.linalg.norm(v)
            if n == 0:
                continue
            rows.append(v / n)
            # size-normalised dominant dept: highest MEAN loading per dept
            means = {dp: Dn[depts == dp, t].mean() for dp in uniq_depts}
            meta.append((space, max(means, key=means.get)))
    T = np.array(rows)

    labels = AgglomerativeClustering(n_clusters=K, metric='cosine', linkage='average').fit_predict(T)

    clusters = []
    for c in range(K):
        idx = np.where(labels == c)[0]
        if len(idx) == 0:
            continue
        spans = sorted(set(meta[i][0] for i in idx), key=['closed', 'bridge', 'open'].index)
        dvotes = [meta[i][1] for i in idx]
        ddom = max(set(dvotes), key=dvotes.count)
        terms = T[idx].sum(0)
        top = ', '.join(vocab[j] for j in np.argsort(terms)[::-1][:8])
        clusters.append((len(spans), len(idx), spans, ddom, top))

    clusters.sort(key=lambda r: (-r[0], -r[1]))
    print(f"  provenance: closed=LSA · bridge=LSI · open=LDA   (3 spaces = robust canonical row)\n")
    print(f"  {'#':>2}  {'spaces':22} {'dept':>5}  consensus terms")
    print(f"  {'─'*2}  {'─'*22} {'─'*5}  {'─'*40}")
    for i, (nsp, nmemb, spans, dd, top) in enumerate(clusters):
        tag = '★★★' if nsp == 3 else ('★★ ' if nsp == 2 else '★  ')
        print(f"  {i+1:>2}  {tag} {'+'.join(spans):17} {dd:>5}  {top}")
    n3 = sum(1 for c in clusters if c[0] == 3)
    n2 = sum(1 for c in clusters if c[0] == 2)
    print(f"\n  robust (all 3 spaces): {n3}   ·   bridge (2 spaces): {n2}   ·   method-specific (1): {len(clusters)-n3-n2}")


if __name__ == '__main__':
    main()
