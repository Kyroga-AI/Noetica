#!/usr/bin/env python3
"""
cluster_analysis — does the OCW chunk-embedding space have cluster structure, and can we
exploit it for retrieval?  Answers four things on a real field's vectors:

  1. ELBOW       — k-means inertia vs k (+ silhouette). Where's the knee? = natural #topics.
  2. INNER/OUTER — a 2-level (coarse outer, fine inner) hierarchy, IVF-style.
  3. IVF-kNN     — search only the n_probe nearest OUTER clusters, then kNN. Recall vs brute
                   force + the speedup (the whole point: skip 95% of the cosine work).
  4. DIVERSITY   — do top-k brute-force hits collapse into one cluster (redundant near-dups)?
                   If so, cluster-aware selection (one per cluster) buys coverage per token.

Run:  python3 scripts/cluster_analysis.py [field] [--cap N]
"""
import os, sys, glob, json, base64, time, random
import numpy as np
from sklearn.cluster import MiniBatchKMeans
from sklearn.metrics import silhouette_score

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
FIELD = next((a for a in sys.argv[1:] if not a.startswith('-')), 'physics')
CAP = int(sys.argv[sys.argv.index('--cap') + 1]) if '--cap' in sys.argv else 50000
SEED = 1729
rng = np.random.default_rng(SEED)


def load_field(field):
    rows = []
    for fp in glob.glob(os.path.join(BRAIN, field, '*.jsonl')):
        for line in open(fp, errors='replace'):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
                v = np.frombuffer(base64.b64decode(o['vec']), dtype=np.float32)
            except Exception:
                continue
            if v.size == 768:
                rows.append(v)
    M = np.vstack(rows).astype(np.float32)
    M /= (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)   # unit-norm → dot = cosine
    return M


def knee(ks, inertia):
    # normalized "distance from the chord" (kneedle-style): the k whose inertia point is
    # farthest below the straight line from first to last → the elbow.
    x = np.array(ks, float); y = np.array(inertia, float)
    x = (x - x.min()) / (x.max() - x.min() + 1e-9)
    y = (y - y.min()) / (y.max() - y.min() + 1e-9)
    # chord from (0, y[0]) to (1, y[-1]); distance of each point below it
    d = (y[0] + (y[-1] - y[0]) * x) - y
    return ks[int(np.argmax(d))]


def main():
    t0 = time.time()
    M = load_field(FIELD)
    if len(M) > CAP:
        M = M[rng.choice(len(M), CAP, replace=False)]
    N, D = M.shape
    print(f"# cluster_analysis · field={FIELD} · N={N:,} chunks · D={D} · loaded in {time.time()-t0:.1f}s\n")

    # ── 1. ELBOW ──────────────────────────────────────────────────────────────────────
    ks = [4, 8, 16, 32, 64, 128, 256]
    sil_sample = M[rng.choice(N, min(5000, N), replace=False)]
    print("  ELBOW (k-means inertia + silhouette)")
    print(f"  {'k':>5} {'inertia':>12} {'Δ%':>7} {'silhouette':>11}")
    inertias, sils = [], []
    for k in ks:
        km = MiniBatchKMeans(n_clusters=k, random_state=SEED, n_init=3, batch_size=2048, max_iter=100).fit(M)
        inertias.append(km.inertia_)
        lab = km.predict(sil_sample)
        sil = silhouette_score(sil_sample, lab, metric='cosine') if len(set(lab)) > 1 else float('nan')
        sils.append(sil)
        d = '' if len(inertias) < 2 else f'{100*(inertias[-2]-inertias[-1])/inertias[-2]:>6.1f}'
        print(f"  {k:>5} {km.inertia_:>12.0f} {d:>7} {sil:>11.3f}")
    kn = knee(ks, inertias)
    ksil = ks[int(np.nanargmax(sils))]
    print(f"\n  → inertia ELBOW at k≈{kn}  ·  best silhouette at k={ksil} ({max(sils):.3f})")
    print(f"  → silhouette {'LOW (continuous topic space — clusters blend)' if max(sils) < 0.1 else 'shows real separation'}")

    # ── 2. INNER / OUTER (2-level IVF) ────────────────────────────────────────────────
    k_out = max(kn, int(np.sqrt(N)))            # coarse cells ~ sqrt(N) is the IVF rule of thumb
    print(f"\n  INNER/OUTER hierarchy:  outer={k_out} coarse cells (~√N), inner = chunks per cell")
    outer = MiniBatchKMeans(n_clusters=k_out, random_state=SEED, n_init=3, batch_size=4096, max_iter=100).fit(M)
    sizes = np.bincount(outer.labels_, minlength=k_out)
    print(f"  cell sizes: min={sizes.min()} median={int(np.median(sizes))} max={sizes.max()} "
          f"(balanced≈{N//k_out}) · empty={int((sizes==0).sum())}")

    # ── 3. IVF-kNN: recall + speedup vs brute force ───────────────────────────────────
    print(f"\n  IVF-kNN retrieval (search nearest n_probe cells, then kNN k=8):")
    cents = outer.cluster_centers_
    cents /= (np.linalg.norm(cents, axis=1, keepdims=True) + 1e-9)
    cell_idx = [np.where(outer.labels_ == c)[0] for c in range(k_out)]
    Q = M[rng.choice(N, 200, replace=False)]                 # queries = held-out chunk vecs
    K = 8
    # ground truth: brute force
    t = time.time()
    gt = []
    for q in Q:
        gt.append(set(np.argsort(M @ q)[::-1][:K]))
    t_flat = (time.time() - t) / len(Q) * 1000
    for n_probe in [1, 2, 4, 8]:
        t = time.time(); rec = 0; scanned = 0
        for qi, q in enumerate(Q):
            cells = np.argsort(cents @ q)[::-1][:n_probe]
            cand = np.concatenate([cell_idx[c] for c in cells]) if len(cells) else np.array([], int)
            scanned += len(cand)
            if len(cand):
                top = cand[np.argsort(M[cand] @ q)[::-1][:K]]
                rec += len(gt[qi] & set(top.tolist())) / K
        t_ivf = (time.time() - t) / len(Q) * 1000
        print(f"   n_probe={n_probe}:  recall@{K}={rec/len(Q):>5.1%}  scans {scanned/len(Q)/N:>5.1%} of corpus  "
              f"({t_flat/max(t_ivf,1e-6):>4.1f}× faster)")

    # ── 4. DIVERSITY: are brute-force top-k redundant (same cell)? ─────────────────────
    fine = max(kn, 32)
    inner = MiniBatchKMeans(n_clusters=fine, random_state=SEED, n_init=3, batch_size=4096).fit(M)
    distinct = []
    for q in Q[:100]:
        top = np.argsort(M @ q)[::-1][:K]
        distinct.append(len(set(inner.labels_[top])))
    print(f"\n  DIVERSITY: brute-force top-{K} hits span {np.mean(distinct):.1f}/{K} distinct clusters on average")
    print(f"  → {'REDUNDANT: top hits collapse into few clusters; cluster-aware (1/cell) buys coverage' if np.mean(distinct) < K*0.6 else 'already diverse'}")
    print(f"\n# done in {time.time()-t0:.0f}s")


if __name__ == '__main__':
    main()
