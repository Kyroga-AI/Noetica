#!/usr/bin/env python3
"""mit-materials-board — the learning loop's TRAINING substrate (the roadmap: practice on MIT's OWN
tests/quizzes/psets WITH solutions BEFORE taking MMLU). Pulls captured course chunks from GCS, pairs
exam/assignment 'problem' material with 'solution' 'gold' material, and extracts practice items
{course, problem, solution, final_answer?}. The full board (run the arms, grade vs solution) comes after
brain v1; this scaffold builds + sizes the practice set and validates the gold-answer extraction.
  python3 scripts/mit-materials-board.py [N_courses]   → emits canon/mit-practice.jsonl + yield report
"""
import os, sys, json, re, subprocess
GCS='gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses/'
PROBLEM={'exam','assignment','recitation'}; GOLD={'solution'}
N=int(sys.argv[1]) if len(sys.argv)>1 else 30
# final-answer extraction from a worked solution (numeric/boxed/"answer:")
ANS=[re.compile(r'\\boxed\{([^}]+)\}'), re.compile(r'(?:final\s+answer|answer)\s*[:=]\s*([^\n.;]{1,40})',re.I),
     re.compile(r'=\s*([-+]?\d[\d.,]*\s*(?:[a-zA-Z%°/]+)?)\s*$',re.M)]
def final_answer(txt):
    for rx in ANS:
        mm=rx.findall(txt)
        if mm: return mm[-1].strip()[:40]
    return None
def gcs_ls(p):
    return subprocess.run(['gcloud','storage','ls',p],capture_output=True,text=True,timeout=120).stdout.splitlines()
def gcs_cat(u):
    return subprocess.run(['gcloud','storage','cat',u],capture_output=True,text=True,timeout=60).stdout
courses=[u for u in gcs_ls(GCS) if u.endswith('.jsonl')]
items=[]; with_sol=0; scanned=0
for u in courses[:N*4]:
    if scanned>=N: break
    try: rows=[json.loads(l) for l in gcs_cat(u).splitlines() if l.strip()]
    except Exception: continue
    mats=set(r['material'] for r in rows)
    if not (mats & GOLD): continue
    with_sol+=1; scanned+=1
    course=os.path.basename(u)[:-6]
    probs=[r['text'] for r in rows if r['material'] in PROBLEM]
    sols=[r['text'] for r in rows if r['material'] in GOLD]
    for s in sols:
        fa=final_answer(s)
        items.append({'course':course,'problem':(probs[0][:300] if probs else ''),'solution':s[:800],
                      'final_answer':fa,'has_answer':bool(fa)})
with open('canon/mit-practice.jsonl','w') as f:
    for it in items: f.write(json.dumps(it)+'\n')
ans=sum(1 for it in items if it['has_answer'])
print(f"scanned {scanned} courses w/ solutions · extracted {len(items)} practice items · {ans} with an auto-extractable final answer ({100*ans//max(len(items),1)}%)")
print(f"→ canon/mit-practice.jsonl  (the MIT practice substrate; full board = run arms + grade vs solution, after brain v1)")
if items:
    ex=next((it for it in items if it['has_answer']),items[0])
    print(f"  sample: [{ex['course'][:30]}] answer={ex['final_answer']}  sol='{ex['solution'][:60]}...'")
