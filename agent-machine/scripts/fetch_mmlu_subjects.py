#!/usr/bin/env python3
"""
fetch_mmlu_subjects — populate the eval bank with MMLU subjects so a DOMAIN brain can be tested on real
multiple-choice. Defaults to the five MMLU MEDICAL subjects (the medicine-board question set); the medicine
brain field (built from the MedRAG textbooks) is graded against them exactly like the STEM brain is graded
against the STEM subjects.

cais/mmlu maps 1:1 to the bench's bank schema {subject: [{subject, question, choices[], answer:int}]}, so
this just fetches, formats, and MERGES into the bank (existing subjects preserved).

Run (needs `pip install datasets`):  python3 scripts/fetch_mmlu_subjects.py
  MMLU_BANK             bank path (default ~/.noetica/corpus/benchmarks/mmlu_stem.json — the one the bench reads)
  MMLU_FETCH_SUBJECTS   comma list (default the 5 medical subjects); use e.g. professional_law for a legal board
"""
import os, json

BANK = os.environ.get('MMLU_BANK', os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json'))
MEDICAL = ['anatomy', 'clinical_knowledge', 'college_medicine', 'professional_medicine', 'medical_genetics']
# Canonical MMLU subject slugs (the 57-task set). We iterate THIS literal list and use the env-supplied request
# only as a membership filter, so any subject we fetch/log is one of these constants — never a raw value flowing
# from os.environ. That validates the request against the real task set AND keeps logged subject names out of any
# data flow from the environment (clears the CWE-312 false positive on logging config-derived strings).
MMLU_SUBJECTS = [
    'abstract_algebra', 'anatomy', 'astronomy', 'business_ethics', 'clinical_knowledge', 'college_biology',
    'college_chemistry', 'college_computer_science', 'college_mathematics', 'college_medicine', 'college_physics',
    'computer_security', 'conceptual_physics', 'econometrics', 'electrical_engineering', 'elementary_mathematics',
    'formal_logic', 'global_facts', 'high_school_biology', 'high_school_chemistry', 'high_school_computer_science',
    'high_school_european_history', 'high_school_geography', 'high_school_government_and_politics',
    'high_school_macroeconomics', 'high_school_mathematics', 'high_school_microeconomics', 'high_school_physics',
    'high_school_psychology', 'high_school_statistics', 'high_school_us_history', 'high_school_world_history',
    'human_aging', 'human_sexuality', 'international_law', 'jurisprudence', 'logical_fallacies', 'machine_learning',
    'management', 'marketing', 'medical_genetics', 'miscellaneous', 'moral_disputes', 'moral_scenarios',
    'nutrition', 'philosophy', 'prehistory', 'professional_accounting', 'professional_law', 'professional_medicine',
    'professional_psychology', 'public_relations', 'security_studies', 'sociology', 'us_foreign_policy',
    'virology', 'world_religions',
]
_requested = {s.strip() for s in os.environ.get('MMLU_FETCH_SUBJECTS', ','.join(MEDICAL)).split(',') if s.strip()}
SUBJECTS = [s for s in MMLU_SUBJECTS if s in _requested]


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
    added = 0
    for subj in SUBJECTS:
        try:
            ds = load_dataset('cais/mmlu', subj, split='test')
        except Exception as e:
            print(f"  ! {subj} skipped: {type(e).__name__}", flush=True)
            continue
        rows = []
        for r in ds:
            ch, a = r.get('choices'), r.get('answer')
            if not ch or len(ch) < 2 or a is None:
                continue
            rows.append({'subject': subj, 'question': r['question'], 'choices': list(ch), 'answer': int(a)})
        if rows:
            bank[subj] = rows
            added += len(rows)
            print(f"# {subj}: {len(rows)} questions", flush=True)
    os.makedirs(os.path.dirname(BANK), exist_ok=True)
    json.dump(bank, open(BANK, 'w'))
    print(f"# bank now has {len(bank)} subjects (+{added} questions) → {BANK}", flush=True)


if __name__ == '__main__':
    main()
