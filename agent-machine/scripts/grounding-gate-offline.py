import json, collections
rows=[json.loads(l) for l in open('ckpt-frontier0630.jsonl') if l.strip()]
def ok(r,a): return str(r.get(a+'_ok')).lower() in ('true','1')
def f(r,k):
    v=r.get(k)
    try: return float(v)
    except: return None
n=len(rows)
print(f"n={n}")
print("\n=== overall accuracy per arm ===")
for a in ['baseline','ground','prod','opcompute','reason']:
    print(f"  {a:10} {100*sum(ok(r,a) for r in rows)/n:.1f}%")

# what confidence signal is present?
print("\n=== gate_agree / vote_share coverage ===")
for k in ['gate_agree','vote_share','gate_reliability']:
    vals=[f(r,k) for r in rows if f(r,k) is not None]
    print(f"  {k}: {len(vals)}/{n} present, min={min(vals):.2f} max={max(vals):.2f}" if vals else f"  {k}: none")

# CRAG gate simulation: pick a confidence key; if conf>=t -> closed-book(baseline), else -> retrieval arm
def sim(conf_key, retr_arm, ts):
    conf=[f(r,conf_key) for r in rows]
    best=None
    for t in ts:
        c=0
        for i,r in enumerate(rows):
            cf=conf[i]
            use_base = (cf is not None and cf>=t)
            arm='baseline' if use_base else retr_arm
            c+=ok(r,arm)
        acc=100*c/n
        if best is None or acc>best[1]: best=(t,acc)
    return best

base=100*sum(ok(r,'baseline') for r in rows)/n
ts=[i/100 for i in range(40,101,5)]
print("\n=== CRAG confidence-gate sim: conf>=t ? baseline : <retrieval arm> ===")
for conf_key in ['gate_agree','vote_share']:
    for retr in ['ground','prod','opcompute']:
        t,acc=sim(conf_key,retr,ts)
        print(f"  conf={conf_key:11} retr={retr:9} best_t={t:.2f}  acc={acc:.1f}%   (base {base:.1f}, always-{retr} {100*sum(ok(r,retr) for r in rows)/n:.1f})")

# oracle per-question ceiling across the good arms
oracle=100*sum(any(ok(r,a) for a in ['baseline','ground','prod','opcompute']) for r in rows)/n
print(f"\n  ORACLE (perfect per-Q pick among baseline/ground/prod/opcompute) = {oracle:.1f}%")

# what did the DEPLOYED gate_decision actually do?
print("\n=== deployed gate_decision distribution ===")
dd=collections.Counter(str(r.get('gate_decision')) for r in rows)
for k,v in dd.most_common(): print(f"  {k}: {v}")
