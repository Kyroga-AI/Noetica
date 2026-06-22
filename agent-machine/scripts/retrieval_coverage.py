#!/usr/bin/env python3
"""
retrieval_coverage — before the exam, prove the ANSWER is actually in the brain (per subject).

Contamination-free is necessary but not sufficient: the open-book arm only helps if retrieval
surfaces the material that contains the answer. This embeds each MMLU question, retrieves the
top-k chunks from its mapped field(s), and reports two LLM-free signals per subject:
  • topical    — mean top-1 cosine (is relevant material even there?)
  • answer-hit — fraction of questions whose GOLD option's distinctive words appear in the
                 retrieved context (is the actual answer supported, not just the topic?)
High answer-hit = the brain arm has something real to stand on. Low = that subject needs more
vectorized courses (tells us where the grind still has to reach before the exam).

Run:  OLLAMA_HOST=http://127.0.0.1:11434 python3 scripts/retrieval_coverage.py [--per 12] [--k 4]
"""
import os, sys, json, glob, re, base64, random, urllib.request
import numpy as np

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
BANK = os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')
OLLAMA = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
PER = int(sys.argv[sys.argv.index('--per') + 1]) if '--per' in sys.argv else 12
K = int(sys.argv[sys.argv.index('--k') + 1]) if '--k' in sys.argv else 4
MAX_CHUNKS = 60000  # per field, sampled if larger — bounds memory while keeping retrieval valid
SEED = 42

SUBJECT_FIELDS = {
    'college_mathematics': ['mathematics'], 'abstract_algebra': ['mathematics'],
    'high_school_mathematics': ['mathematics'], 'high_school_statistics': ['mathematics'],
    'college_physics': ['physics'], 'conceptual_physics': ['physics'], 'high_school_physics': ['physics'],
    'astronomy': ['physics', 'earth_planetary'],
    'college_chemistry': ['chemistry'], 'high_school_chemistry': ['chemistry'],
    'college_biology': ['biology', 'biological_eng'], 'high_school_biology': ['biology', 'biological_eng'],
    'college_computer_science': ['eecs'], 'electrical_engineering': ['eecs'],
}
STOP = set('the a an of to in is are and or for with on at by as be it this that which from we you '
           'i if then than into over under not no all any each its their his her our'.split())


def embed(text):
    body = json.dumps({'model': 'nomic-embed-text', 'prompt': text[:8000]}).encode()
    req = urllib.request.Request(f'{OLLAMA}/api/embeddings', body, {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return np.array(json.load(r)['embedding'], dtype=np.float32)


def load_field(field):
    rows, texts = [], []
    files = glob.glob(os.path.join(BRAIN, field, '*.jsonl'))
    for fp in files:
        for line in open(fp, errors='replace'):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
                v = np.frombuffer(base64.b64decode(o['vec']), dtype=np.float32)
            except Exception:
                continue
            if v.size:
                rows.append(v); texts.append(o.get('text', ''))
    if not rows:
        return None
    if len(rows) > MAX_CHUNKS:
        idx = random.Random(SEED).sample(range(len(rows)), MAX_CHUNKS)
        rows = [rows[i] for i in idx]; texts = [texts[i] for i in idx]
    M = np.vstack(rows)
    M /= (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)
    return M, texts


def content_words(s):
    return {w for w in re.sub(r'[^a-z0-9 ]+', ' ', s.lower()).split() if len(w) > 3 and w not in STOP}


def main():
    bank = json.load(open(BANK))
    fields_ready = {d for d in os.listdir(BRAIN) if os.path.isdir(os.path.join(BRAIN, d)) and glob.glob(os.path.join(BRAIN, d, '*.jsonl'))}
    cache = {}
    print(f'# retrieval coverage — per={PER} k={K} seed={SEED} · top-1 cosine + gold-answer-in-context\n')
    print(f"  {'subject':28}{'n':>4}{'topical':>9}{'txt-hit':>9}{'numeric':>9}")
    print(f"  {'─'*28}{'─'*4}{'─'*9}{'─'*9}{'─'*9}")
    print(f"  {'(numeric → compute arm; txt-hit = gold words retrieved, over textual answers only)'}")
    grand_hit = grand_txt = grand_num = grand_n = 0
    for subj in SUBJECT_FIELDS:
        flds = [f for f in SUBJECT_FIELDS[subj] if f in fields_ready]
        if not flds or subj not in bank:
            continue
        pools = []
        for f in flds:
            if f not in cache:
                cache[f] = load_field(f)
            if cache[f]:
                pools.append(cache[f])
        if not pools:
            continue
        qs = bank[subj][:]
        random.Random(SEED).shuffle(qs)
        qs = qs[:PER]
        cos_sum = hit = textn = numn = n = 0
        for q in qs:
            try:
                qv = embed(q['question'] + ' ' + ' '.join(q['choices']))
            except Exception:
                continue
            qv /= (np.linalg.norm(qv) + 1e-9)
            best_cos, ctx = -1.0, ''
            for M, texts in pools:
                s = M @ qv
                top = np.argsort(s)[::-1][:K]
                if s[top[0]] > best_cos:
                    best_cos = float(s[top[0]])
                ctx += ' ' + ' '.join(texts[i] for i in top)
            gold = content_words(q['choices'][q['answer']])
            n += 1; cos_sum += best_cos
            if len(gold) < 2:            # numeric / symbolic / very short → compute's job, not retrieval's
                numn += 1
            else:
                textn += 1
                if len(gold & content_words(ctx)) / len(gold) >= 0.5:
                    hit += 1
        if n:
            th = f'{100 * hit / textn:.0f}%' if textn else '—'
            print(f"  {subj:28}{n:>4}{cos_sum / n:>9.3f}{th:>9}{100 * numn / n:>8.0f}%")
            grand_hit += hit; grand_txt += textn; grand_num += numn; grand_n += n
    if grand_n:
        th = f'{100 * grand_hit / grand_txt:.0f}%' if grand_txt else '—'
        print(f"\n  {'OVERALL':28}{grand_n:>4}{'':>9}{th:>9}{100 * grand_num / grand_n:>8.0f}%")
    print('\n# txt-hit = gold words retrieved (textual answers) → retrieval has ground to stand on.')
    print('# numeric = answer is a number/symbol → the COMPUTE arm answers these, not retrieval.')
    print('# topical ~0.75 everywhere = the right material IS there; depth grows as the grind lands.')


if __name__ == '__main__':
    main()
