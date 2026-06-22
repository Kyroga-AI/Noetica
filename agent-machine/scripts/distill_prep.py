#!/usr/bin/env python3
"""
distill_prep — the missing distillation phase, free and local (STaR / rejection sampling, grounded
in OUR corpus). The frontier (DeepSeek-R1, AI2 Tülu/RLVR, Thinking-Machines on-policy distill) turns
inference-technique into model WEIGHTS. This prepares the training data for that, the right way:

  1. SYNTHESIZE a verifiable MCQ from each MIT-OCW chunk (teacher writes Q + 4 options + the answer
     the passage supports) — training data from our moat, NO MMLU contamination.
  2. ANSWER it with the student model + chain-of-thought.
  3. KEEP only CORRECT traces (rejection sampling / STaR) — these are good reasoning trajectories.
  4. WRITE SFT JSONL (chat format) → ready to LoRA-fine-tune a strong base (the GPU step, later).

The loop: distill → stronger student → regenerate better traces → repeat.

Run:  OLLAMA_HOST=http://127.0.0.1:11434 python3 scripts/distill_prep.py [field] [--n 200]
"""
import os, sys, glob, json, re, time, urllib.request

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
OLLAMA = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
FIELD = next((a for a in sys.argv[1:] if not a.startswith('-')), 'biology')
N = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 200
TEACHER = os.environ.get('TEACHER', 'qwen2.5:7b')
STUDENT = os.environ.get('STUDENT', 'qwen2.5:7b')
OUT = os.path.expanduser(f'~/.noetica/distill/{FIELD}.sft.jsonl')
LETTERS = 'ABCD'


def chat(model, prompt, temperature=0.0):
    body = json.dumps({'model': model, 'stream': False, 'options': {'temperature': temperature},
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(f'{OLLAMA}/api/chat', body, {'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r).get('message', {}).get('content', '') or ''
    except Exception:
        return ''


def load_chunks(field, n):
    texts = []
    for fp in glob.glob(os.path.join(BRAIN, field, '*.jsonl')):
        for line in open(fp, errors='replace'):
            line = line.strip()
            if not line:
                continue
            try:
                t = json.loads(line).get('text', '')
            except Exception:
                continue
            if t and 200 < len(t) < 1400:        # substantive, self-contained passages make better Qs
                texts.append(t)
            if len(texts) >= n * 3:
                break
        if len(texts) >= n * 3:
            break
    import random
    random.Random(1729).shuffle(texts)
    return texts[:n]


def gen_mcq(chunk):
    raw = chat(TEACHER, "From the passage below, write ONE self-contained multiple-choice question that "
               "tests a key fact or concept it states. Give exactly 4 options labelled A) B) C) D), with "
               "exactly one correct. The question must be answerable WITHOUT the passage (self-contained). "
               "End with a final line 'ANSWER: X'.\n\nPassage:\n" + chunk)
    m = re.search(r'ANSWER:\s*([A-D])', raw, re.I)
    if not m:
        return None
    ans = m.group(1).upper()
    q = raw[:m.start()].strip()
    if len(q) < 30 or not re.search(r'\bA\)', q) or not re.search(r'\bD\)', q):
        return None
    return {'question': q, 'answer': ans}


def raft_context(golden, distractors):
    """RAFT (UC Berkeley): mix the GOLDEN passage with DISTRACTORS so the model learns to ignore
    noise and reason only with the relevant context — the fix for 'retrieval hurts' baked into data."""
    import random
    docs = [golden] + distractors
    random.Random(hash(golden) & 0xffff).shuffle(docs)
    return '\n\n'.join(f"[{i+1}] {d[:500]}" for i, d in enumerate(docs))


def answer_cot(question, context=''):
    ctx = f"Context (some passages are relevant, some are distractors — use only what helps):\n{context}\n\n" if context else ''
    raw = chat(STUDENT, ctx + question + "\n\nReason step by step in a few sentences (cite the relevant "
               "context), then end with a single line 'FINAL: X' (X = A, B, C, or D).", temperature=0.0)
    m = re.findall(r'FINAL:\s*([A-D])', raw, re.I)
    return raw.strip(), (m[-1].upper() if m else ''), ctx


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    chunks = load_chunks(FIELD, N)
    print(f"# distill_prep · field={FIELD} · {len(chunks)} chunks · teacher={TEACHER} student={STUDENT}")
    gen = kept = 0
    t0 = time.time()
    import random
    rng = random.Random(1729)
    with open(OUT, 'w') as out:
        for i, ch in enumerate(chunks):
            mcq = gen_mcq(ch)
            if not mcq:
                continue
            gen += 1
            distractors = rng.sample([c for c in chunks if c is not ch], min(2, max(0, len(chunks) - 1)))
            ctx_docs = raft_context(ch, distractors)                       # RAFT: golden + distractors
            reasoning, pred, ctx = answer_cot(mcq['question'], ctx_docs)
            if pred and pred == mcq['answer']:          # rejection sampling: keep only CORRECT trajectories
                kept += 1
                out.write(json.dumps({'messages': [
                    {'role': 'user', 'content': ctx + mcq['question'] + "\n\nReason step by step (cite the relevant context), then 'FINAL: X'."},
                    {'role': 'assistant', 'content': reasoning if 'FINAL:' in reasoning else reasoning + f"\nFINAL: {pred}"},
                ], 'field': FIELD, 'gold': mcq['answer'], 'raft': True}) + '\n')
            if (i + 1) % 10 == 0:
                sys.stderr.write(f"  {i+1}/{len(chunks)} · generated {gen} · kept {kept} ({time.time()-t0:.0f}s)\n")
    yld = 100 * kept / gen if gen else 0
    print(f"\n# wrote {kept} SFT trajectories → {OUT}")
    print(f"# generated {gen} MCQs · kept {kept} correct ({yld:.0f}% yield) in {time.time()-t0:.0f}s")
    print(f"# next: accumulate across fields → LoRA-fine-tune a strong base (the GPU step, containerized, on approval)")


if __name__ == '__main__':
    main()
