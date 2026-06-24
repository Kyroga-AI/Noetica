#!/usr/bin/env python3
"""
marker-extract — RECOVER the math at the source. pymupdf got the glyphs but flattened the 2D structure
(F=m!a!, i=1 i=1); Marker is math-aware PDF→markdown/LaTeX and rebuilds it (\\vec F = m\\vec a, \\sum_{i=1}^n).
Loads the Marker models ONCE, walks the corpus, and writes a clean {pdf}.marker.md sidecar next to each PDF.
build-corpus prefers that sidecar over pymupdf, so re-vectorizing produces a structurally-recovered brain.

Targeted + resumable: GOLD/math material first (exam/solution/lecture/pset), skip existing sidecars, so a
crash/relaunch continues. Run on a GPU VM (Marker is neural).

Run:  MARKER_CORPUS=/opt/corpus python3 scripts/marker-extract.py
  MARKER_LIMIT  max PDFs this run (0 = all)   MARKER_ALL=1  every PDF (default: gold/math-bearing only)
"""
import os, sys, re

CORPUS = os.environ.get('MARKER_CORPUS', os.path.expanduser('~/Downloads/MIT OCW/_corpus'))
LIMIT = int(os.environ.get('MARKER_LIMIT', '0'))
ALL = os.environ.get('MARKER_ALL') == '1'
# gold/math-bearing filenames (the material whose formulas we most need to recover) — else skip to save GPU time
GOLD = re.compile(r'(exam|solution|soln|pset|problem|hw|homework|quiz|midterm|final|notes|lecture|recitation)', re.I)


def pdfs(root):
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if fn.lower().endswith('.pdf'):
                yield os.path.join(dp, fn)


def main():
    print(f"# marker-extract · {CORPUS} · {'ALL pdfs' if ALL else 'gold/math only'}", flush=True)
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered
    converter = PdfConverter(artifact_dict=create_model_dict())   # load the neural models ONCE
    done = skipped = failed = 0
    for pdf in pdfs(CORPUS):
        if not ALL and not GOLD.search(os.path.basename(pdf)):
            continue
        sidecar = pdf + '.marker.md'
        if os.path.exists(sidecar):
            skipped += 1; continue
        try:
            text, _ext, _imgs = text_from_rendered(converter(pdf))
            if text and len(text.strip()) > 40:
                with open(sidecar, 'w') as f:
                    f.write(text)
                done += 1
                if done % 25 == 0:
                    print(f"  marker: {done} recovered, {skipped} cached, {failed} failed", flush=True)
            else:
                failed += 1
        except Exception as e:
            failed += 1
            print(f"  ! {os.path.basename(pdf)}: {type(e).__name__} {str(e)[:80]}", flush=True)
        if LIMIT and done >= LIMIT:
            break
    print(f"# done — {done} sidecars written, {skipped} cached, {failed} failed. Re-run build-corpus to re-vectorize.", flush=True)


if __name__ == '__main__':
    main()
