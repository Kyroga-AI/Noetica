import json, collections
rows=[json.loads(l) for l in open('ckpt-frontier0630.jsonl') if l.strip()]
def ok(r,a): return str(r.get(a+'_ok')).lower() in ('true','1')
n=len(rows); arms=['baseline','ground','prod','opcompute','reason']

print("=== UNIQUE correct: questions ONLY this arm solves (among the 5) ===")
for a in arms:
    u=sum(1 for r in rows if ok(r,a) and not any(ok(r,b) for b in arms if b!=a))
    print(f"  {a:10} uniquely solves {u} Qs")

print("\n=== grounding's marginal value ON TOP of compute (opcompute) ===")
g_adds=sum(1 for r in rows if ok(r,'ground') and not ok(r,'opcompute'))
g_loses=sum(1 for r in rows if not ok(r,'ground') and ok(r,'opcompute'))
union=100*sum(1 for r in rows if ok(r,'ground') or ok(r,'opcompute'))/n
print(f"  ground rescues {g_adds} Qs opcompute misses; opcompute rescues {g_loses} ground misses")
print(f"  opcompute alone {100*sum(ok(r,'opcompute') for r in rows)/n:.1f}%  ->  ground∪opcompute (oracle) {union:.1f}%")

print("\n=== does ground help on the slice where the model LACKS canon coverage? ===")
# hypothesis: retrieve when canon_grounding in {ungrounded,partial}; trust closed-book when grounded
by=collections.defaultdict(lambda:[0,0,0])  # [n, baseline_ok, ground_ok]
for r in rows:
    cg=str(r.get('canon_grounding'))
    by[cg][0]+=1; by[cg][1]+=ok(r,'baseline'); by[cg][2]+=ok(r,'ground')
for cg,(c,b,g) in sorted(by.items()):
    print(f"  canon_grounding={cg:11} n={c:3}  baseline {100*b/c:5.1f}%  ground {100*g/c:5.1f}%  net {100*(g-b)/c:+5.1f}")

print("\n=== principled gate: ground on {ungrounded,partial}, baseline on {grounded} ===")
for trigger in [{'ungrounded'},{'ungrounded','partial'}]:
    c=0
    for r in rows:
        arm='ground' if str(r.get('canon_grounding')) in trigger else 'baseline'
        c+=ok(r,arm)
    print(f"  retrieve-when {sorted(trigger)}: {100*c/n:.1f}%  (base 62.7)")

print("\n=== best SINGLE arm vs prod (what actually ships) ===")
for a in arms: print(f"  {a:10} {100*sum(ok(r,a) for r in rows)/n:.1f}%")
