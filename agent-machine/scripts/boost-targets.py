#!/usr/bin/env python3
"""boost-targets — the self-improving loop's DRIVER. Reads a board checkpoint and emits the ranked
ENRICHMENT TARGETS for the next cycle: the residual cells (where the ensemble fails) weighted by
recoverable questions (gap × n) — i.e. AdaBoost's "focus on the errors" applied to the symbol substrate.
Each target is typed by the GAP it implies → the enrichment ACTION:
  compute-mode residual  → MISSING OPERATOR   → symbolic-regression (PySR/AI-Feynman) on worked examples,
                                                 else frontier-author the law (typed 'induced'/'deduced')
  lookup-mode residual   → MISSING SYMBOL/DEF  → glossary definition-mining (grow the 1033 symbols)
  eval-mode residual     → MISSING RELATION    → graph induction (prereq/analogy — assemble into the KG)
So every locked-in board automatically yields the next boosting round's work, fully auditable.
Usage: python3 scripts/boost-targets.py /tmp/ckpt-ground.jsonl"""
import sys, re, json, os
from collections import Counter
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
try:
    from model_solve import MODELS
    DOMAIN_OPS = Counter(MODELS[k][1] for k in MODELS)
except Exception:
    DOMAIN_OPS = Counter()
CKPT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ckpt-ground.jsonl'
LETTERS='ABCD'; SEED=1729; PER=50
ORDER=['college_mathematics','college_physics','college_chemistry','college_biology','abstract_algebra','high_school_statistics']
SUBJ_DOMAIN={'college_chemistry':'chemistry','college_physics':'classical_mechanics','college_mathematics':'mathematics',
             'abstract_algebra':'mathematics','high_school_statistics':'statistics','college_biology':'(none — lookup)'}
def make_rng(s):
    a=[s&0xFFFFFFFF]; M=0xFFFFFFFF; im=lambda x,y:((x&M)*(y&M))&M
    def r():
        a[0]=(a[0]+0x6D2B79F5)&M; t=im(a[0]^(a[0]>>15),a[0]|1); t=(((t+im(t^(t>>7),61|t))&M)^t)&M
        return ((t^(t>>14))&M)/4294967296
    return r
def shuffle(arr,rng):
    a=arr[:]
    for i in range(len(a)-1,0,-1): j=int(rng()*(i+1)); a[i],a[j]=a[j],a[i]
    return a
m=json.load(open('/tmp/mmlu_stem.json')); rand=make_rng(SEED); samples={s:shuffle(m[s],rand)[:PER] for s in ORDER}
ck=[json.loads(l) for l in open(CKPT) if l.strip()]
NUM=re.compile(r'(?<![A-Za-z_])\d+(?:\.\d+)?')
def opmode(q):
    low=q.lower()
    if re.search(r'statement 1|statement 2',low) or re.search(r'\bwhich\b.{0,70}\b(true|false|cannot|must|necessarily)\b',low): return 'eval'
    if (re.search(r'\b(calculate|compute|solve|determine|derive|find the)\b|\b(value of|how many|number of|probability|the order of)\b',low) or len(NUM.findall(q))>=2): return 'compute'
    return 'lookup'
ARMS=['baseline','brain','rerank','ground']
cells={}
for r in ck:
    q=samples[r['subject']][r['i']]; key=(r['subject'],opmode(q['question']))
    c=cells.setdefault(key,{'n':0,'gr':0,'orc':0})
    c['n']+=1; c['gr']+= 1 if r.get('ground_pred')==r['gold'] else 0
    c['orc']+= 1 if any(r.get(f'{a}_pred')==r['gold'] for a in ARMS) else 0
rows=[]
for (subj,op),c in cells.items():
    gap=100*(c['orc']-c['gr'])/c['n']; recov=(c['orc']-c['gr'])
    action={'compute':'OPERATOR  → symbolic-regression / frontier-author','lookup':'SYMBOL/DEF → glossary mining','eval':'RELATION  → graph induction'}[op]
    rows.append((recov, subj.split('_')[-1], op, c['n'], round(100*c['gr']/c['n']), round(100*c['orc']/c['n']), round(gap), action))
rows.sort(reverse=True)
print("════════ BOOSTING TARGETS — the next enrichment cycle (residual, ranked by recoverable-q) ════════")
print(f"{'subject×op':22}{'n':>3}{'grnd':>6}{'orcl':>6}{'gap':>5}{'recov':>7}   enrichment action")
for recov,subj,op,n,gr,orc,gap,action in rows[:10]:
    if recov<=0: continue
    dom=SUBJ_DOMAIN.get('college_'+subj,SUBJ_DOMAIN.get(subj,subj))
    ops=DOMAIN_OPS.get(dom,'-') if op=='compute' else ''
    print(f"{subj+' × '+op:22}{n:>3}{gr:>5}%{orc:>5}%{gap:>4}{recov:>7.0f}   {action}"+(f"  [catalog ops in {dom}: {ops}]" if op=='compute' else ''))
print(f"\n  catalog operators by domain: {dict(DOMAIN_OPS)}")
print(f"  → each row is one boosting target; compute-rows with FEW catalog ops are the symbolic-regression/author priority.")
