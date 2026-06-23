#!/usr/bin/env python3
"""
log-to-transcript — reconstruct a meta_combiner training transcript from a board VERDICT LOG, so we can
learn the council law from runs we already have (no re-run needed). Each verdict line carries every arm's
PREDICTED letter + correctness mark, e.g.

    11. baseline:✓D  brain:✓D  qgen:✓D  compute:✗A  gate:✓D  medprompt:✗C  elim:✗B  fiftyfifty:✗A  /D

so per question we recover: gold (the trailing /X, or any ✓ arm's letter — a correct arm's letter IS the
gold), and each arm's predicted letter (· = abstained → omitted). Dedupes the repeated lines the log
re-sync produces. Skip lines produced during an embed-flake window with --after / --before line bounds.

Run:  python3 scripts/log-to-transcript.py board.log [out.jsonl]   [--max-line N]  (drop lines past N — e.g. flake onset)
"""
import re, sys, json

if len(sys.argv) < 2:
    sys.exit('usage: log-to-transcript.py board.log [out.jsonl] [--max-line N]')
LOG = sys.argv[1]
OUT = next((a for a in sys.argv[2:] if not a.startswith('--')), '/tmp/meta/transcript.jsonl')
MAXLINE = next((int(a.split('=')[-1] if '=' in a else sys.argv[sys.argv.index(a) + 1])
                for a in sys.argv if a.startswith('--max-line')), None)

ARM_RE = re.compile(r'([a-z][a-z0-9]+):([✓✗])([A-D·])')
GOLD_RE = re.compile(r'/([A-D])\s*$')

rows = {}
for ln_no, line in enumerate(open(LOG, errors='replace'), 1):
    if MAXLINE and ln_no > MAXLINE:
        break
    pairs = ARM_RE.findall(line)
    if 'baseline' not in [p[0] for p in pairs]:
        continue
    gold = None
    m = GOLD_RE.search(line.rstrip())
    if m:
        gold = m.group(1)
    else:                                    # derive gold from any CORRECT arm (its letter == gold)
        for arm, mark, letter in pairs:
            if mark == '✓' and letter in 'ABCD':
                gold = letter; break
    if not gold:
        continue
    row = {'gold': gold}
    for arm, mark, letter in pairs:
        if arm in ('champion', 'learned'):   # combiners — not input features (circular)
            continue
        row[f'{arm}_pred'] = letter if letter in 'ABCD' else '?'   # · (abstain) → '?'
    # dedup identical verdict rows (the log re-sync repeats them)
    key = json.dumps(row, sort_keys=True)
    rows[key] = row

import os
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
with open(OUT, 'w') as f:
    for r in rows.values():
        f.write(json.dumps(r) + '\n')
arms = sorted({k[:-5] for r in rows.values() for k in r if k.endswith('_pred')})
print(f'# {len(rows)} unique questions → {OUT}  · arms: {", ".join(arms)}')
