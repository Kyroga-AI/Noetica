#!/usr/bin/env python3
"""corruption-triage — classify a corpus chunk's extraction-corruption class so a GOLD-material remediation
pipeline can route it correctly instead of treating "damaged" as one bucket.

Built from a hand-labeled 25-chunk manual review (2026-07-01) that found FOUR distinct failure classes with
FOUR distinct correct remedies — collapsing them into "corrupt/not corrupt" was the mistake the bracket-glyph
signature made (1.07% floor vs a manually-measured ~32-40% true rate):

  CLEAN          — no action.
  MINOR/MODERATE — structural flattening (fraction/exponent/subscript collapse, e.g. 'sin2n+1' for
                   'sin^{2n+1}'). Content is PRESENT, just needs reflow. Safe for FRONTIER REAUTHORING
                   in-place (the model reconstructs it from context — same principle as
                   feedback_glossary_frontier_authored: the frontier writes the delta, never the weak model).
  SEVERE         — reading-order scrambled (many single-character lines — a column/figure-overlap misread).
                   Content signal is present but unordered; reauthoring risks confabulating the specific
                   missing math. Route to a HIGHER-PRIORITY Marker re-extraction pass, do not guess.
  UNRECOVERABLE  — font-CMap decode failure (embedded/custom font pymupdf can't map to Unicode -> Latin-
                   extended/accented noise with ZERO semantic content). No text-based remedy exists.
                   Route to OCR-fallback re-extraction (image-based, not text-layer) or quarantine.

Usage:
  python3 scripts/corruption-triage.py --self-test              # validates against the 25-chunk labeled set
  python3 scripts/corruption-triage.py --batch < chunks.jsonl    # {text} per line -> {class} per line
"""
import argparse
import json
import re
import sys

BRACKET_RE = re.compile(r'[⌈-⌋⎛-⎳]')                    # matrix/array delimiter pieces (the known partial signal)
# font-CMap failure: dense runs of Latin-extended/accented chars OUTSIDE normal prose usage (not just á/é/ñ,
# but the full extended-Latin + spacing-modifier block PDF font substitution dumps into).
GARBAGE_RE = re.compile(r'[¡-ÿĀ-ſʰ-˿]')
WORD_RE = re.compile(r'\b[a-zA-Z]{3,}\b')                # recognizable English/math-prose word tokens


def classify(text: str) -> str:
    if not text or len(text.strip()) < 20:
        return 'CLEAN'   # too short to meaningfully assess; not a false-positive risk either way

    lines = [ln for ln in text.split('\n') if ln.strip()]
    if not lines:
        return 'CLEAN'

    # Signal 1 — UNRECOVERABLE: font-decode garbage. High density of extended-Latin/accent-block chars
    # relative to length, combined with almost no recognizable word tokens (real prose still has SOME
    # accented chars in isolation — café, naïve — but not at this density with no words around them).
    garbage_ratio = len(GARBAGE_RE.findall(text)) / max(1, len(text))
    word_count = len(WORD_RE.findall(text))
    word_density = word_count / max(1, len(text) / 50)   # words per ~50 chars; prose is usually >1
    if garbage_ratio > 0.03 and word_density < 0.5:
        return 'UNRECOVERABLE'

    # Signal 1b — UNRECOVERABLE (extreme scrambling variant): not font-CMap garbage, but reading-order
    # collapse so total that MOST lines are a single character — measured on 2 hand-labeled samples where
    # garbage_ratio stayed near zero (real ASCII, no font-decode noise) but 51-71% of lines were length 1.
    # SAFETY-CRITICAL: this must be checked BEFORE the SEVERE/MODERATE word-fragment logic below, because a
    # false negative here (routing to REAUTHOR) means fabricating content into near-total signal loss — the
    # single worst possible triage error. Conflating this with font-CMap UNRECOVERABLE is fine operationally:
    # both correctly route to "do not reauthor, needs stronger re-extraction," even though the root causes differ.
    one_char_ratio = sum(1 for ln in lines if len(ln.strip()) == 1) / len(lines)
    if one_char_ratio > 0.4:
        return 'UNRECOVERABLE'

    # Signal 2 — SEVERE vs MODERATE, both produce lots of short lines, so line-length alone can't tell them
    # apart. What DOES distinguish them: SEVERE (reading-order scrambling) breaks WORDS into multi-letter
    # alphabetic fragments ('co', 'se', 'lin', 'e' — pieces of "course", "semester", "lineage"), because it's
    # PROSE getting scrambled. MODERATE (equation flattening) produces short lines that are numbers, single
    # letters, or math operators/symbols — because it's a FORMULA losing its 2D layout, not prose losing its
    # order. So: fraction of short (<=4 char) lines that are MULTI-CHAR PURE-ALPHABETIC (word fragments) vs
    # single-char/numeric/symbolic (math tokens) is the real discriminator.
    tiny_lines = [ln.strip() for ln in lines if len(ln.strip()) <= 4]
    tiny_ratio = len(tiny_lines) / len(lines)
    if tiny_ratio > 0.25:
        word_fragments = sum(1 for ln in tiny_lines if len(ln) >= 2 and ln.isalpha())
        frag_ratio = word_fragments / max(1, len(tiny_lines))
        if frag_ratio > 0.35:
            return 'SEVERE'          # scrambled prose: 'b','co','se','lin' — pieces of words
        return 'MODERATE'            # scrambled math: '6','·','θ','=' — pieces of formulas

    # Signal 3 — MINOR/MODERATE: structural flattening without a dominant short-line fraction. Either the
    # known matrix-bracket-glyph signal, or a smaller but still present fraction of broken-up short lines.
    if BRACKET_RE.search(text):
        return 'MODERATE'
    short_lines = sum(1 for ln in lines if len(ln.strip()) <= 6)
    short_ratio = short_lines / len(lines)
    if short_ratio > 0.08:
        return 'MODERATE' if short_ratio > 0.15 else 'MINOR'
    # even ONE clearly-isolated short numeric/symbolic line (a stray denominator/exponent) in an otherwise
    # long, clean chunk is still worth a MINOR flag — ratio alone dilutes to invisible in a long chunk.
    if any(len(ln.strip()) <= 2 and not ln.strip().isalpha() for ln in lines):
        return 'MINOR'

    return 'CLEAN'


def _parse_dump(path):
    """Parse the '===== [i] field / slug / material (len=N) =====' dump format back into samples."""
    hdr = re.compile(r'^===== \[(\d+)\] .* =====$')
    samples = {}
    idx, buf = None, []
    for line in open(path):
        m = hdr.match(line.rstrip('\n'))
        if m:
            if idx is not None:
                samples[idx] = '\n'.join(buf).strip()
            idx, buf = int(m.group(1)), []
        elif idx is not None:
            buf.append(line.rstrip('\n'))
    if idx is not None:
        samples[idx] = '\n'.join(buf).strip()
    return samples


def self_test():
    sys.path.insert(0, '/tmp')
    from labeled_calibration import LABELS  # the hand-labeled ground truth from the manual review
    samples = _parse_dump('/tmp/calibration-full.txt')

    # The pipeline only needs 4 ACTION buckets (MINOR and MODERATE both mean "frontier reauthors in place") —
    # the 5-way manual labeling was for precision during review; scoring against the 4 real routing decisions.
    ACTION = {'CLEAN': 'CLEAN', 'MINOR': 'REAUTHOR', 'MODERATE': 'REAUTHOR', 'SEVERE': 'SEVERE', 'UNRECOVERABLE': 'UNRECOVERABLE'}

    correct = 0
    confusion = {}
    for i in sorted(samples):
        true_label = ACTION[LABELS[i]]
        pred_raw = classify(samples[i])
        pred = ACTION[pred_raw]
        ok = pred == true_label
        correct += ok
        confusion[(true_label, pred)] = confusion.get((true_label, pred), 0) + 1
        print(f'[{i:2}] true={LABELS[i]:14} pred={pred_raw:14} {"OK" if ok else "MISS"}')

    print(f'\naccuracy (4-action buckets): {correct}/{len(samples)} = {100*correct/len(samples):.0f}%')
    print('confusion (true_action, pred_action) -> count:')
    for k, v in sorted(confusion.items()):
        print(f'  {k} -> {v}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    ap.add_argument('--batch', action='store_true')
    a = ap.parse_args()
    if a.self_test:
        self_test()
    elif a.batch:
        for line in sys.stdin:
            if not line.strip():
                continue
            r = json.loads(line)
            print(json.dumps({'class': classify(r.get('text', ''))}))
    else:
        print('usage: --self-test or --batch', file=sys.stderr)
