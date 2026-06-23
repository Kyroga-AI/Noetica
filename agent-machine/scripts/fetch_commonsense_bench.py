#!/usr/bin/env python3
"""
fetch_commonsense_bench — pull 4-choice knowledge/commonsense benchmarks (OpenBookQA + ARC) into the eval
bank to test the commonsense brain. Stage 1 of the commonsense-KG ablation (docs/experiments/
commonsense-kg-ablation.md): these are RETRIEVAL-designed benches (OpenBookQA is literally "open book"),
so they're the right first test of "does a knowledge brain help?" and they fit the current A–D bench with
NO changes. The 5-choice CommonsenseQA / 3-choice SocialIQA (the ConceptNet-aligned tests) come in Stage 2
once the bench is N-choice. Filters to exactly 4 choices.

Run (needs `pip install datasets`):  python3 scripts/fetch_commonsense_bench.py
  MMLU_BANK   bank path (default ~/.noetica/corpus/benchmarks/mmlu_stem.json — what the bench reads)
"""
import os, json

BANK = os.environ.get('MMLU_BANK', os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json'))


def _ans_idx(ak):
    ak = str(ak).strip()
    if ak in ('A', 'B', 'C', 'D', 'E'):
        return ord(ak) - 65
    if ak.isdigit():
        return int(ak) - 1
    return None


def main():
    try:
        from datasets import load_dataset
    except ImportError:
        raise SystemExit("need `pip install datasets pyarrow`")
    bank = {}
    if os.path.exists(BANK):
        try:
            bank = json.load(open(BANK))
        except Exception:
            bank = {}

    def ingest(name, ds, qkey):
        rows = []
        for r in ds:
            ch = (r.get('choices') or {}).get('text') or []
            ai = _ans_idx(r.get('answerKey'))
            if len(ch) == 4 and ai is not None and 0 <= ai < 4:    # only 4-choice items fit the A–D bench
                rows.append({'subject': name, 'question': r.get(qkey) or '', 'choices': list(ch), 'answer': ai})
        bank[name] = rows
        print(f"# {name}: {len(rows)} questions", flush=True)

    try:
        ingest('openbookqa', load_dataset('openbookqa', 'main', split='test'), 'question_stem')
    except Exception as e:
        print(f"  ! openbookqa skipped: {type(e).__name__} {str(e)[:100]}", flush=True)
    for cfg, subj in (('ARC-Challenge', 'arc_challenge'), ('ARC-Easy', 'arc_easy')):
        try:
            ingest(subj, load_dataset('ai2_arc', cfg, split='test'), 'question')
        except Exception as e:
            print(f"  ! {subj} skipped: {type(e).__name__} {str(e)[:100]}", flush=True)

    os.makedirs(os.path.dirname(BANK), exist_ok=True)
    json.dump(bank, open(BANK, 'w'))
    print(f"# bank now has {len(bank)} subjects → {BANK}", flush=True)


if __name__ == '__main__':
    main()
