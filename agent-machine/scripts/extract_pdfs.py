#!/usr/bin/env python3
"""
extract_pdfs — cache the READING content from each course's PDFs, so topic derivation runs
on the substantive layer instead of lecture transcripts.

Per course: pick the PDFs most likely to be readings/notes (de-prioritise video-transcript
PDFs), extract a capped number of pages, strip OCW headers + speaker labels, and write one
consolidated text file to ~/Downloads/MIT OCW/_pdftext/<slug>.txt. Resumable (skips cached).

Run:  python3 scripts/extract_pdfs.py
"""
import os, glob, re, sys
import pypdf

CORPUS = os.path.expanduser('~/Downloads/MIT OCW/_corpus')
CACHE = os.path.expanduser('~/Downloads/MIT OCW/_pdftext')
N_PDF, N_PAGE, CAP = 5, 10, 40000
os.makedirs(CACHE, exist_ok=True)

IS_TRANSCRIPT = re.compile(r'track|300k|\.mp4|transcript|_pron', re.I)
IS_READING = re.compile(r'lec|note|read|chap|text|notes|problem|pset|hand', re.I)
HEADER = re.compile(r'^\s*(MITOCW|MIT[\w]*\|)|^[A-Z][A-Z .]{3,}:\s*$')  # OCW header / SPEAKER:
# Delete C0 control chars except tab/LF/CR (str.translate table — avoids a regex control range).
CTRL_DEL = dict.fromkeys(c for c in range(0x20) if c not in (0x09, 0x0a, 0x0d))
SURR = re.compile('[\ud800-\udfff]')   # lone surrogates from PDF math fonts — not UTF-8-encodable


def pdf_score(path):
    n = os.path.basename(path).lower()
    return (5 if IS_READING.search(n) else 0) - (10 if IS_TRANSCRIPT.search(n) else 0)


def clean(t):
    t = SURR.sub('', t.translate(CTRL_DEL)).replace('�', ' ')
    t = '\n'.join(l for l in t.splitlines() if not HEADER.match(l))
    return re.sub(r'[ \t]+', ' ', t)


def main():
    dirs = sorted(glob.glob(CORPUS + '/*/'))
    done = skipped = 0
    for i, d in enumerate(dirs):
        slug = os.path.basename(d.rstrip('/'))
        out = os.path.join(CACHE, slug + '.txt')
        if os.path.exists(out):
            skipped += 1
            continue
        pdfs = sorted(glob.glob(d + '/**/*.pdf', recursive=True), key=pdf_score, reverse=True)[:N_PDF]
        text, total = [], 0
        for p in pdfs:
            if total >= CAP:
                break
            try:
                r = pypdf.PdfReader(p, strict=False)
                for pg in r.pages[:N_PAGE]:
                    if total >= CAP:
                        break
                    s = clean(pg.extract_text() or '')
                    text.append(s); total += len(s)
            except Exception:
                continue
        open(out, 'w', encoding='utf-8', errors='ignore').write(' '.join(text))
        done += 1
        if done % 50 == 0:
            print(f"  {i+1}/{len(dirs)} courses · extracted {done} · {total} chars last", flush=True)
    print(f"# extract_pdfs done — extracted {done}, skipped(cached) {skipped}, total courses {len(dirs)}")


if __name__ == '__main__':
    main()
