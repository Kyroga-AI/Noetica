#!/usr/bin/env python3
"""
rf_meta — a learned ensemble over per-CHOICE retrieval + structural features. The question:
can a boosted forest, given only how well each option is *supported by the corpus* (plus cheap
structural signals), pick the right MCQ answer — and beat the naive "pick the highest-cosine
option"? And what falls out of the FEATURE IMPORTANCES (which signal actually carries the answer)?

Per (question, option) row → target = is_correct. Models predict P(correct); per question we take
the argmax option. Split is by QUESTION (group split) so no option of a test question leaks into
train. Baselines: random (1/n_choices) and argmax-cosine. Includes the new cluster-diversity
feature from cluster_analysis (how many distinct outer-cells the option's support spans).

Run:  OLLAMA_HOST=http://127.0.0.1:11434 python3 scripts/rf_meta.py [--per 120] [--cap 25000]
"""
import os, sys, json, glob, base64, re, time, urllib.request
import numpy as np
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.cluster import MiniBatchKMeans
from sklearn.model_selection import GroupShuffleSplit
from sklearn.inspection import permutation_importance

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
BANK = os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')
OLLAMA = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
PER = int(sys.argv[sys.argv.index('--per') + 1]) if '--per' in sys.argv else 120
CAP = int(sys.argv[sys.argv.index('--cap') + 1]) if '--cap' in sys.argv else 25000
SEED = 1729
rng = np.random.default_rng(SEED)

SUBJECT_FIELDS = {
    'college_mathematics': ['mathematics'], 'abstract_algebra': ['mathematics'],
    'high_school_statistics': ['mathematics'], 'conceptual_physics': ['physics'],
    'college_chemistry': ['chemistry'], 'high_school_biology': ['biology'],
    'electrical_engineering': ['eecs'],
}
STOP = set('the a an of to in is are and or for with on at by as be it this that which from we you i if '
           'then than into over under not no all any each its their his her our'.split())
FEATS = ['sim_qc', 'rank_qc', 'gap_best', 'gap_2nd', 'is_argmax', 'pos', 'len_tok', 'len_rank',
         'numeric', 'ctx_overlap', 'cluster_div']
_ecache = {}


def embed(text):
    if text in _ecache:
        return _ecache[text]
    body = json.dumps({'model': 'nomic-embed-text', 'prompt': text[:6000]}).encode()
    req = urllib.request.Request(f'{OLLAMA}/api/embeddings', body, {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        v = np.array(json.load(r)['embedding'], dtype=np.float32)
    v /= (np.linalg.norm(v) + 1e-9)
    _ecache[text] = v
    return v


def words(s):
    return {w for w in re.sub(r'[^a-z0-9 ]+', ' ', s.lower()).split() if len(w) > 3 and w not in STOP}


def load_field(field):
    rows, txt = [], []
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
                rows.append(v); txt.append(o.get('text', ''))
    M = np.vstack(rows).astype(np.float32)
    M /= (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)
    if len(M) > CAP:
        idx = rng.choice(len(M), CAP, replace=False)
        M = M[idx]; txt = [txt[i] for i in idx]
    km = MiniBatchKMeans(n_clusters=max(32, int(np.sqrt(len(M)))), random_state=SEED, n_init=3, batch_size=4096).fit(M)
    return M, txt, km.labels_


def main():
    t0 = time.time()
    bank = json.load(open(BANK))
    ready = {d for d in os.listdir(BRAIN) if os.path.isdir(os.path.join(BRAIN, d))}
    fields = {}
    X, y, groups, sims_all = [], [], [], []
    qid = 0
    print(f"# rf_meta · per={PER}/subject · field cap={CAP:,} · embedding locally …")
    for subj, flds in SUBJECT_FIELDS.items():
        flds = [f for f in flds if f in ready]
        if not flds or subj not in bank:
            continue
        for f in flds:
            if f not in fields:
                fields[f] = load_field(f)
        M, txt, lab = fields[flds[0]]
        qs = bank[subj][:]
        rng.shuffle(qs)
        for q in qs[:PER]:
            ch = q['choices']
            if len(ch) < 2:
                continue
            try:
                feats_qc, ctx_idx = [], []
                sims = []
                for c in ch:
                    qv = embed(q['question'] + ' ' + c)
                    s = M @ qv
                    top = np.argsort(s)[::-1][:8]
                    sims.append(float(s[top[0]]))
                    ctx_idx.append(top)
            except Exception:
                continue
            sims = np.array(sims)
            order = np.argsort(sims)[::-1]
            rank = {int(j): r for r, j in enumerate(order)}
            best, second = sims[order[0]], (sims[order[1]] if len(order) > 1 else sims[order[0]])
            lens = np.array([len(c.split()) for c in ch])
            lrank = {int(j): r for r, j in enumerate(np.argsort(lens)[::-1])}
            for j, c in enumerate(ch):
                cw = words(c)
                ctxw = set()
                for ti in ctx_idx[j]:
                    ctxw |= words(txt[ti][:400])
                ov = len(cw & ctxw) / (len(cw) + 1e-9)
                div = len(set(lab[ctx_idx[j]]))
                X.append([sims[j], rank[j], sims[j] - best, sims[j] - second, int(j == order[0]),
                          j, lens[j], lrank[j], int(bool(re.fullmatch(r'[-+0-9.,/eπ() ]+', c.strip()))),
                          ov, div])
                y.append(int(j == q['answer']))
                groups.append(qid)
                sims_all.append((qid, j, sims[j], j == q['answer']))
            qid += 1
        sys.stderr.write(f"  {subj}: {qid} questions cumulative ({time.time()-t0:.0f}s)\n")

    X = np.array(X, float); y = np.array(y); groups = np.array(groups)
    nq = len(set(groups))
    print(f"\n# {nq} questions · {len(X)} option-rows · {X.shape[1]} features · built in {time.time()-t0:.0f}s\n")

    # baselines
    bysim = {}
    for qg, j, s, ok in sims_all:
        if qg not in bysim or s > bysim[qg][0]:
            bysim[qg] = (s, ok)
    argmax_acc = np.mean([ok for _, ok in bysim.values()])
    rand_acc = np.mean([1.0 / len(np.where(groups == g)[0]) for g in set(groups)])
    print(f"  baseline  random          : {rand_acc:.1%}")
    print(f"  baseline  argmax-cosine    : {argmax_acc:.1%}   (pick the best-supported option)")

    # group train/test (no option leakage), evaluate question-level argmax
    gss = GroupShuffleSplit(n_splits=1, test_size=0.3, random_state=SEED)
    tr, te = next(gss.split(X, y, groups))
    def qacc(model, name):
        model.fit(X[tr], y[tr])
        p = model.predict_proba(X[te])[:, 1]
        # per test question, argmax predicted P(correct)
        tg = groups[te]; correct = 0; nqte = 0
        for g in np.unique(tg):
            m = np.where(tg == g)[0]
            pick = m[np.argmax(p[m])]
            correct += y[te][pick]; nqte += 1
        print(f"  MODEL     {name:16}: {correct/nqte:.1%}   (test n={nqte} q)")
        return model
    print()
    rf = qacc(RandomForestClassifier(n_estimators=400, max_depth=None, min_samples_leaf=3,
                                     class_weight='balanced', random_state=SEED, n_jobs=-1), 'RandomForest')
    gb = qacc(HistGradientBoostingClassifier(max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
                                             random_state=SEED), 'HistGradientBoost')

    print("\n  FEATURE IMPORTANCE (RF gini · then permutation on test):")
    imp = rf.feature_importances_
    perm = permutation_importance(gb, X[te], y[te], n_repeats=8, random_state=SEED, n_jobs=-1).importances_mean
    order = np.argsort(imp)[::-1]
    print(f"  {'feature':14}{'gini':>8}{'perm(gb)':>10}")
    for i in order:
        print(f"  {FEATS[i]:14}{imp[i]:>8.3f}{perm[i]:>10.3f}")
    print(f"\n# done in {time.time()-t0:.0f}s")


if __name__ == '__main__':
    main()
