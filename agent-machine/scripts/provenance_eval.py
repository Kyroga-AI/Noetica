#!/usr/bin/env python3
"""provenance_eval — THE load-bearing artifact. A reviewer's critique was right: our KKO/Peirce ontology gives
us the epistemic-tag VOCABULARY (retrieved / deduced / abduced) but NOT the CLASSIFIER. A published label set
proves nothing until a detector assigns those labels correctly against human ground truth. This is that detector,
measured.

It runs the PROVENANCE axis first — the one RAGTruth actually labels: is each generated span GROUNDED in the
source, or not? (the inference-type axis — deductive/inductive/abductive — needs its own labeled set; RAGTruth
doesn't carry it, and we don't pretend it does.) For every response span we compute a support score against the
grounding source (semantic max-sim via MiniLM + lexical containment), tag it grounded/unsupported, and score that
tag against RAGTruth's span-level hallucination annotations. The output is a confusion matrix + precision/recall/F1,
broken down by label_type (Baseless vs Conflict, Evident vs Subtle) and task_type — so we see exactly where the
detector works and where it doesn't (a pure-support detector will catch Baseless but miss Conflict, which has high
overlap; that gap is the case for the verify/NLI layer, reported honestly, not hidden).

Clean-eval: threshold is calibrated on the TRAIN split only, reported on TEST. Scoring is deterministic given the
embedding model + threshold; a manifest (input hash, model, threshold, git rev) makes the score bit-reproducible
against a versioned output — the honest form of the "reproducible" claim.

  python3 scripts/provenance_eval.py                 # full test split, threshold calibrated on train
  RAGTRUTH_DIR=/tmp/ragtruth/dataset N_TEST=600 python3 scripts/provenance_eval.py
"""
import os, sys, re, json, hashlib, subprocess, time
from collections import Counter, defaultdict

RT = os.environ.get('RAGTRUTH_DIR', '/tmp/ragtruth/dataset')
N_TEST = int(os.environ.get('N_TEST', '0'))        # 0 = full test split
N_TRAIN = int(os.environ.get('N_TRAIN', '1200'))   # train responses used only to calibrate the threshold
MODEL = os.environ.get('PROV_EMBED', 'sentence-transformers/all-MiniLM-L6-v2')
OUT = os.environ.get('PROV_OUT', os.path.join(os.path.dirname(__file__), '..', 'canon', 'provenance-eval'))
SEED = int(os.environ.get('PROV_SEED', '1729'))
# detector: 'sim' = a bare similarity threshold (the strawman — proves the ontology alone doesn't classify);
# 'nli'  = source-entails-claim entailment (this IS our verify-layer concept — the real faithfulness detector).
DETECTOR = os.environ.get('PROV_DETECTOR', 'sim')
NLI_MODEL = os.environ.get('PROV_NLI', 'cross-encoder/nli-deberta-v3-small')
NLI_TOPK = int(os.environ.get('PROV_NLI_TOPK', '4'))   # entail against the K most-similar source sentences
NLI_PREMISE = os.environ.get('PROV_NLI_PREMISE', 'union')  # 'union' (top-k joined) | 'single' (max over each)
# OPERATING POINT: τ is chosen to maximize Fβ. Opinionated DEFAULT β=2.0 — recall-weighted, because in the
# faithfulness/regulated tier a missed fabrication (FN, it ships) costs more than a false flag (FP, a human
# re-checks): cost(FN) = β²·cost(FP). This is a DEFAULT, not a policy baked in code — the cost asymmetry is the
# customer's to set (their review capacity, their liability). PROV_BETA tunes it (1.0 = balanced F1; <1 favors
# precision). scripts/operating_point.py re-derives τ for any β / cost-ratio / target-recall from the saved
# per-sentence scores with NO model recompute.
BETA = float(os.environ.get('PROV_BETA', '2.0'))

# ── sentence segmentation with char offsets (so a predicted span aligns to RAGTruth's [start,end) labels) ──
_SENT = re.compile(r'[^.!?\n]*[.!?\n]|[^.!?\n]+$')
def sentences(text):
    out = []
    for m in _SENT.finditer(text):
        s, e = m.start(), m.end()
        if text[s:e].strip():
            out.append((s, e, text[s:e]))
    return out

_WORD = re.compile(r"[a-z0-9][a-z0-9'\-]*")
_STOP = set("the a an of to in on at for and or but is are was were be been being this that these those it its as by with from into than then so such not no can will would could may might do does did has have had he she they we you i his her their our your".split())
def content_tokens(s):
    return {w for w in _WORD.findall(s.lower()) if w not in _STOP and len(w) > 1}

def lexical_support(span, src_tokens):
    """Fraction of the span's content tokens that appear anywhere in the source (containment)."""
    t = content_tokens(span)
    if not t:
        return 1.0          # no content words (boilerplate) → treat as supported, don't flag
    return len(t & src_tokens) / len(t)

# ── grounding text per source: pull the actual material the response must be faithful to ──
def grounding_text(si):
    """source_info is a dict (QA: question+passages; Data2txt: structured fields; Summary: the document) or str."""
    if isinstance(si, str):
        return si
    parts = []
    for k, v in si.items():
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, dict):
            parts.append(' '.join(f'{a}: {b}' for a, b in v.items()))
        else:
            parts.append(json.dumps(v))
    return '\n'.join(parts)

def load():
    src = {}
    for l in open(os.path.join(RT, 'source_info.jsonl')):
        r = json.loads(l)
        src[r['source_id']] = r
    resp = [json.loads(l) for l in open(os.path.join(RT, 'response.jsonl'))]
    return src, resp

def main():
    import numpy as np
    from sentence_transformers import SentenceTransformer
    import random
    random.seed(SEED)

    src, resp = load()
    by_split = defaultdict(list)
    for r in resp:
        by_split[r['split']].append(r)

    def sample(rows, n):
        rows = [r for r in rows if r['source_id'] in src]
        if n and len(rows) > n:
            rows = random.sample(rows, n)
        return rows

    train = sample(by_split['train'], N_TRAIN)
    test = sample(by_split['test'], N_TEST)
    print(f"# provenance_eval — detector={DETECTOR}  embed={MODEL}" + (f"  nli={NLI_MODEL}" if DETECTOR == 'nli' else ''))
    print(f"# train(calibration)={len(train)}  test(report)={len(test)}  seed={SEED}", flush=True)

    model = SentenceTransformer(MODEL)
    ce = None; entail_idx = 1
    if DETECTOR in ('nli', 'combo'):
        from sentence_transformers import CrossEncoder
        ce = CrossEncoder(NLI_MODEL)
        # find the 'entailment' column from the model's own label map (don't hard-code the order)
        id2label = getattr(ce.model.config, 'id2label', {0: 'contradiction', 1: 'entailment', 2: 'neutral'})
        entail_idx = next((i for i, l in id2label.items() if str(l).lower().startswith('entail')), 1)
        print(f"# NLI labels={id2label}  entail_idx={entail_idx}", flush=True)

    # embed each unique source's grounding sentences ONCE (sources are shared across responses)
    src_sents = {}      # source_id -> list of sentence strings
    src_tokset = {}     # source_id -> content-token set (for lexical)
    need = {r['source_id'] for r in train + test}
    for sid in need:
        g = grounding_text(src[sid]['source_info'])
        ss = [t for _, _, t in sentences(g)] or [g]
        src_sents[sid] = ss
        src_tokset[sid] = content_tokens(g)
    uniq = sorted(need)
    # batch-encode all source sentences
    flat, idx = [], {}
    for sid in uniq:
        idx[sid] = (len(flat), len(flat) + len(src_sents[sid]))
        flat.extend(src_sents[sid])
    t0 = time.time()
    print(f"# encoding {len(flat)} source sentences across {len(uniq)} sources…", flush=True)
    src_emb_all = model.encode(flat, batch_size=256, normalize_embeddings=True, show_progress_bar=False)
    src_emb = {sid: src_emb_all[a:b] for sid, (a, b) in idx.items()}

    def score_response(r):
        """Return per-sentence records: (start,end,span, support, predicted_unsupported, actually_halluc, label_type)."""
        sid = r['source_id']
        sents = sentences(r['response'])
        if not sents:
            return []
        spans = [t for _, _, t in sents]
        emb = model.encode(spans, batch_size=128, normalize_embeddings=True, show_progress_bar=False)
        se = src_emb[sid]
        sims = emb @ se.T                       # (n_resp_sent, n_src_sent) cosine (normalized)
        ssents = src_sents[sid]
        # NLI mode: entail each response sentence against its top-K most-similar source sentences (one batch/response)
        nli_support = None
        if ce is not None and se.shape[0]:
            import numpy as _np
            pairs, owner = [], []
            for i in range(len(sents)):
                topk = [int(j) for j in _np.argsort(-sims[i])[:NLI_TOPK]]
                if NLI_PREMISE == 'union':
                    # one premise = the union of the top-k source sentences (handles claims that AGGREGATE
                    # across multiple source sentences — the precision-killer for single-premise entailment)
                    pairs.append((' '.join(ssents[j] for j in topk), sents[i][2])); owner.append(i)
                else:
                    for j in topk:
                        pairs.append((ssents[j], sents[i][2])); owner.append(i)
            probs = ce.predict(pairs, apply_softmax=True, show_progress_bar=False) if pairs else []
            nli_support = [0.0] * len(sents)
            for k, ow in enumerate(owner):
                nli_support[ow] = max(nli_support[ow], float(probs[k][entail_idx]))
        recs = []
        labs = r['labels']
        for i, (s, e, span) in enumerate(sents):
            sem = float(sims[i].max()) if se.shape[0] else 0.0
            lex = lexical_support(span, src_tokset[sid])
            nli = nli_support[i] if nli_support is not None else None
            support = nli if (DETECTOR == 'nli' and nli is not None) else max(sem, lex)  # entailment, else max(sem,lex)
            # ground truth: this sentence is hallucinated if its [s,e) overlaps any label span
            lt = None
            for lab in labs:
                if lab['start'] < e and s < lab['end']:
                    lt = lab['label_type']; break
            recs.append({'support': support, 'sem': sem, 'lex': lex, 'nli': nli, 'halluc': lt is not None, 'label_type': lt})
        return recs

    # score train + test
    def score_all(rows):
        all_recs = []
        for j, r in enumerate(rows):
            all_recs.append((r, score_response(r)))
            if (j + 1) % 200 == 0:
                print(f"  …scored {j+1}/{len(rows)} ({time.time()-t0:.0f}s)", flush=True)
        return all_recs

    print("# scoring train (threshold calibration)…", flush=True)
    train_scored = score_all(train)
    print("# scoring test (held-out report)…", flush=True)
    test_scored = score_all(test)

    # ── combo: a learned combiner over [semantic, lexical, entailment] (the council/CISC concept) ──
    # sim and nli catch DIFFERENT hallucinations (fabricated specifics vs baseless additions); a logistic
    # over the three signals, fit on TRAIN only, finds the trade neither single threshold can. We overwrite
    # each rec's 'support' with the calibrated P(grounded) so the threshold/report pipeline runs unchanged.
    if DETECTOR == 'combo':
        from sklearn.linear_model import LogisticRegression
        tr = [rec for _, recs in train_scored for rec in recs]
        Xtr = [[r['sem'], r['lex'], r['nli'] or 0.0] for r in tr]
        ytr = [1 if r['halluc'] else 0 for r in tr]
        clf = LogisticRegression(class_weight='balanced', max_iter=1000).fit(Xtr, ytr)
        allrecs = [r for _, recs in (train_scored + test_scored) for r in recs]
        ph = clf.predict_proba([[r['sem'], r['lex'], r['nli'] or 0.0] for r in allrecs])[:, 1]
        for r, p in zip(allrecs, ph):
            r['support'] = 1.0 - float(p)     # P(grounded); flagged unsupported when support < τ
        print(f"# combo logistic  coef[sem,lex,nli]={clf.coef_[0].round(3).tolist()}  intercept={clf.intercept_[0]:.3f}", flush=True)

    # ── calibrate threshold on TRAIN: maximize sentence-level Fβ of the 'unsupported' tag ──
    train_recs = [rec for _, recs in train_scored for rec in recs]
    def score_at(tau, recs, beta=1.0):
        tp = fp = fn = tn = 0
        for rec in recs:
            pred = rec['support'] < tau
            act = rec['halluc']
            if pred and act: tp += 1
            elif pred and not act: fp += 1
            elif not pred and act: fn += 1
            else: tn += 1
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec_ = tp / (tp + fn) if tp + fn else 0.0
        b2 = beta * beta
        fb = (1 + b2) * prec * rec_ / (b2 * prec + rec_) if (b2 * prec + rec_) else 0.0
        return fb, prec, rec_, (tp, fp, fn, tn)
    taus = [i / 100 for i in range(15, 95)]
    calibrate = lambda beta: max(taus, key=lambda t: score_at(t, train_recs, beta)[0])
    tau = calibrate(BETA)     # the SHIPPED operating point (opinionated default β, train-calibrated)
    print(f"\n# shipped τ={tau:.2f} at β={BETA} (recall-weighted default; PROV_BETA / operating_point.py to tune)")
    # ── evaluate on TEST ──
    test_recs = [rec for _, recs in test_scored for rec in recs]
    _, prec, rec, (tp, fp, fn, tn) = score_at(tau, test_recs, BETA)
    f1 = score_at(tau, test_recs, 1.0)[0]    # F1 at the shipped τ, for reference

    # ── operating-point trade: same scores, different β, so the knob's effect is visible (not hidden) ──
    op_points = {}
    print("# operating points (τ re-calibrated per β on train, measured on test):")
    for b, lbl in [(0.5, 'precision-favoring'), (1.0, 'balanced (F1)'), (2.0, 'recall-weighted')]:
        tb = calibrate(b); fb, p, r, (a, c, e, g) = score_at(tb, test_recs, b)
        op_points[str(b)] = {'tau': tb, 'precision': p, 'recall': r, 'fbeta': fb,
                             'tp': a, 'fp': c, 'fn': e, 'tn': g}
        print(f"    β={b:>3} ({lbl:18s}) τ={tb:.2f}  P={p:.3f} R={r:.3f} Fβ={fb:.3f}" + ('  ⋆default' if b == BETA else ''))

    # response-level: does the response contain ANY hallucination?
    rtp = rfp = rfn = rtn = 0
    for r, recs in test_scored:
        pred_any = any(x['support'] < tau for x in recs)
        act_any = any(x['halluc'] for x in recs)
        if pred_any and act_any: rtp += 1
        elif pred_any and not act_any: rfp += 1
        elif not pred_any and act_any: rfn += 1
        else: rtn += 1
    rprec = rtp / (rtp + rfp) if rtp + rfp else 0.0
    rrec = rtp / (rtp + rfn) if rtp + rfn else 0.0
    rf1 = 2 * rprec * rrec / (rprec + rrec) if rprec + rrec else 0.0

    # recall by label_type (where the detector works vs where it doesn't — the honest breakdown)
    bytype = defaultdict(lambda: [0, 0])    # label_type -> [caught, total]
    for x in test_recs:
        if x['halluc']:
            bt = bytype[x['label_type']]
            bt[1] += 1
            if x['support'] < tau: bt[0] += 1

    # ── report ──
    print("\n" + "=" * 68)
    print("EPISTEMIC-TAGGING CONFUSION MATRIX — provenance axis (grounded vs unsupported)")
    print("RAGTruth held-out test · human-labeled hallucination spans")
    print("=" * 68)
    print(f"\nSENTENCE-LEVEL (the detector's actual job):")
    print(f"                     actual: HALLUC   actual: FAITHFUL")
    print(f"  pred UNSUPPORTED       TP={tp:5d}          FP={fp:5d}")
    print(f"  pred GROUNDED          FN={fn:5d}          TN={tn:5d}")
    print(f"\n  precision={prec:.3f}  recall={rec:.3f}  F1={f1:.3f}   (n_sentences={len(test_recs)})")
    print(f"\nRESPONSE-LEVEL (any-hallucination flag):")
    print(f"  precision={rprec:.3f}  recall={rrec:.3f}  F1={rf1:.3f}   (n_responses={len(test_scored)})")
    print(f"\nRECALL BY LABEL TYPE — where the support-detector wins vs needs the verify/NLI layer:")
    for lt in ['Evident Baseless Info', 'Subtle Baseless Info', 'Evident Conflict', 'Subtle Conflict']:
        c, t = bytype.get(lt, [0, 0])
        if t:
            print(f"  {lt:24s} recall={c/t:.3f}  ({c}/{t})")
    print("\nNOTE: this is ONE of the two orthogonal axes — PROVENANCE (in-source vs generated).")
    print("The INFERENCE-TYPE axis (deductive/inductive/abductive) is not labeled by RAGTruth;")
    print("its confusion matrix needs a separately-labeled set and is NOT claimed here.")

    # ── manifest: makes the SCORING bit-reproducible against this versioned output ──
    os.makedirs(OUT, exist_ok=True)
    try:
        rev = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True,
                             cwd=os.path.dirname(__file__)).stdout.strip()
    except Exception:
        rev = 'unknown'
    in_hash = hashlib.sha256(
        open(os.path.join(RT, 'response.jsonl'), 'rb').read()).hexdigest()[:16]
    result = {
        'detector': DETECTOR, 'nli_model': NLI_MODEL if DETECTOR == 'nli' else None,
        'nli_premise': NLI_PREMISE if DETECTOR == 'nli' else None,
        'beta': BETA, 'operating_points': op_points,
        'model': MODEL, 'threshold': tau, 'seed': SEED, 'git_rev': rev,
        'ragtruth_response_sha256_16': in_hash,
        'n_train_calib': len(train), 'n_test': len(test), 'n_test_sentences': len(test_recs),
        'sentence_level': {'precision': prec, 'recall': rec, 'f1': f1, 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn},
        'response_level': {'precision': rprec, 'recall': rrec, 'f1': rf1, 'tp': rtp, 'fp': rfp, 'fn': rfn, 'tn': rtn},
        'recall_by_label_type': {k: {'caught': v[0], 'total': v[1]} for k, v in bytype.items()},
        'axis': 'provenance (in-source vs generated); inference-type axis NOT measured here',
    }
    tag = DETECTOR + (f'-{NLI_PREMISE}' if DETECTOR == 'nli' else '')
    outp = os.path.join(OUT, f'ragtruth-provenance.{tag}.json')
    with open(outp, 'w') as f:
        json.dump(result, f, indent=2)
    # per-sentence test scores → operating_point.py re-tunes τ for any β / cost-ratio / target-recall, no recompute
    scoresp = os.path.join(OUT, f'scores.{tag}.jsonl')
    with open(scoresp, 'w') as sf:
        for r in test_recs:
            sf.write(json.dumps({'support': round(r['support'], 4), 'halluc': r['halluc'],
                                 'label_type': r['label_type']}) + '\n')
    print(f"\n# manifest → {outp}  (git {rev[:8]}, input {in_hash})")
    print(f"# scores   → {scoresp}  ({len(test_recs)} sentences — re-tunable without recompute)")

if __name__ == '__main__':
    main()
