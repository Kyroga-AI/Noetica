#!/usr/bin/env python3
"""Build the reliability-gate reference manifold from a board checkpoint.

The gate scores per-question reliability from two cheap, inference-time signals:
  • cross-arm AGREEMENT (how many council arms picked the same letter) — the supervised axis
  • local DENSITY (is this a typical question?) — the unsupervised axis (DBSCAN finding: outliers=errors)
Emits canon/reliability-reference.json: standardizer + reference points (for kNN density) + the
calibration 2x2 (measured P(correct) per agreement×density cell). PIT note: re-run per brain version."""
import json, re, numpy as np
LETTERS='ABCD'; SEED=1729; PER=50
ORDER=['college_mathematics','college_physics','college_chemistry','college_biology','abstract_algebra','high_school_statistics']
def make_rng(seed):
    a=[seed&0xFFFFFFFF]; M=0xFFFFFFFF; imul=lambda x,y:((x&M)*(y&M))&M
    def rng():
        a[0]=(a[0]+0x6D2B79F5)&M; t=imul(a[0]^(a[0]>>15),a[0]|1); t=(((t+imul(t^(t>>7),61|t))&M)^t)&M
        return ((t^(t>>14))&M)/4294967296
    return rng
def shuffle(arr,rng):
    a=arr[:]
    for i in range(len(a)-1,0,-1):
        j=int(rng()*(i+1)); a[i],a[j]=a[j],a[i]
    return a
m=json.load(open('/tmp/mmlu_stem.json'))
rand=make_rng(SEED); samples={s:shuffle(m[s],rand)[:PER] for s in ORDER}
ck=[json.loads(l) for l in open('/tmp/ckpt-ground.jsonl') if l.strip()]
ARMS=['baseline_pred','brain_pred','rerank_pred','ground_pred']
NUM=re.compile(r'(?<![A-Za-z_])\d+(?:\.\d+)?')
DENSF=['log_max_mag','q_len_log','has_number']   # TS-computable density features (no keyed-vec)
from collections import Counter
dens_raw=[]; agree=[]; ok=[]
for r in ck:
    q=samples[r['subject']][r['i']]; s=q['question']
    ns=[abs(float(x)) for x in NUM.findall(s) if x]
    feat=[np.log10(max(ns)) if (ns and max(ns)>0) else 0.0, np.log1p(len(s.split())), 1.0 if ns else 0.0]
    preds=[r[a] for a in ARMS if r.get(a)]; cnt=Counter(preds); plur,pn=cnt.most_common(1)[0]
    dens_raw.append(feat); agree.append(pn/len(preds)); ok.append(1 if plur==r['gold'] else 0)
D=np.array(dens_raw); agree=np.array(agree); ok=np.array(ok); N=len(ok)
mean=D.mean(0); std=D.std(0); std[std==0]=1
Z=(D-mean)/std
# local density = mean distance to k nearest neighbours (smaller = denser)
from sklearn.neighbors import NearestNeighbors
K=10
kd=NearestNeighbors(n_neighbors=K+1).fit(Z).kneighbors(Z)[0][:,1:].mean(1)
dens_thresh=float(np.median(kd))       # below = dense/typical, above = sparse/outlier
dense=kd<=dens_thresh
# calibration 2x2
def acc(mask): return float(ok[mask].mean()) if mask.sum() else None
unanimous=agree>=0.999
cal={
 'agree_dense':  acc(unanimous & dense),  'agree_sparse': acc(unanimous & ~dense),
 'split_dense':  acc(~unanimous & dense), 'split_sparse': acc(~unanimous & ~dense),
 'overall': float(ok.mean()),
}
print(f"N={N}  reference manifold built")
print(f"calibration 2x2 (P correct):")
for k,v in cal.items(): print(f"  {k:14} {v if v is None else round(v,3)}")
# MODEL-AGNOSTIC: the calibration 2x2 is a property of THIS model's agreement/accuracy patterns, so it must
# be keyed by model — a new family re-calibrates and writes its own reference; the gate loads the matching one.
import os, re as _re
MODEL=os.environ.get('MMLU_MODEL','llama3.2:3b')
FAMILY=_re.split(r'[:\-/]',MODEL)[0].lower()   # qwen2.5/llama3.2/gpt/claude → family key
out={'features':DENSF,'scaler':{'mean':mean.tolist(),'std':std.tolist()},
     'reference':Z.tolist(),'density_k':K,'density_threshold':dens_thresh,
     'n_arms_ref':int(np.median([len([r[a] for a in ARMS if r.get(a)]) for r in ck])),
     'calibration':cal,'answer_threshold':0.6,'n':N,'built_from':'ckpt-ground','seed':SEED,
     'model':MODEL,'family':FAMILY}
json.dump(out,open(f'canon/reliability-reference.{FAMILY}.json','w'))   # model-keyed (PIT, per-family)
json.dump(out,open('canon/reliability-reference.json','w'))             # default = last built
print(f"\nwrote canon/reliability-reference.{FAMILY}.json (+ default) for model={MODEL}")
