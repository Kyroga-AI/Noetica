#!/usr/bin/env python3
"""
marker-extract — RECOVER the math at the source. pymupdf got the glyphs but flattened the 2D structure
(F=m!a!, i=1 i=1); Marker is math-aware PDF→markdown/LaTeX and rebuilds it (\\vec F = m\\vec a, \\sum_{i=1}^n).
Loads the Marker models ONCE, walks the corpus, and writes a clean {pdf}.marker.md sidecar next to each PDF.
build-corpus prefers that sidecar over pymupdf, so re-vectorizing produces a structurally-recovered brain.

RESILIENT + INCREMENTAL (like the board): every sidecar is uploaded to GCS the instant it's written and its
path appended to a resume MANIFEST — so a VM death loses nothing and a relaunch (or the on-VM auto-resume loop)
continues exactly where it stopped. A status.json (done/total) is written per file so a stall-watchdog can see
progress. Targeted: GOLD/math material first (exam/solution/lecture/pset) unless MARKER_ALL=1.

Run:  MARKER_CORPUS=/opt/corpus MARKER_SIDECAR_GCS=gs://.../marker-sidecars \\
      MARKER_DONE_MANIFEST=/root/.marker/done.txt MARKER_STATUS=/root/.marker/status.json python3 scripts/marker-extract.py
  MARKER_LIMIT  max NEW sidecars this run (0 = all)   MARKER_ALL=1  every PDF (default: gold/math-bearing only)
"""
import os, re, json, signal, subprocess

CORPUS = os.environ.get('MARKER_CORPUS', os.path.expanduser('~/Downloads/MIT OCW/_corpus'))
LIMIT = int(os.environ.get('MARKER_LIMIT', '0'))
ALL = os.environ.get('MARKER_ALL') == '1'
SIDECAR_GCS = os.environ.get('MARKER_SIDECAR_GCS', '').rstrip('/')   # incremental per-file upload target
DONE_MANIFEST = os.environ.get('MARKER_DONE_MANIFEST', '')           # resume manifest (relpaths, one per line)
STATUS = os.environ.get('MARKER_STATUS', '')                        # done/total status for the stall-watchdog
PDF_TIMEOUT = int(os.environ.get('MARKER_PDF_TIMEOUT', '300'))      # HARD per-PDF ceiling — a hung PDF can't freeze the run
GOLD = re.compile(r'(exam|solution|soln|pset|problem|hw|homework|quiz|midterm|final|notes|lecture|recitation)', re.I)
rel = lambda p: os.path.relpath(p, CORPUS)


class _Timeout(Exception):
    pass


def _alarm(_sig, _frm):
    raise _Timeout()


signal.signal(signal.SIGALRM, _alarm)


def gcs_cp(local, remote):
    try:
        subprocess.run(['gsutil', '-q', 'cp', local, remote], timeout=120, check=False)
    except Exception:
        pass


def pdfs(root):
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if fn.lower().endswith('.pdf'):
                yield os.path.join(dp, fn)


def main():
    print(f"# marker-extract · {CORPUS} · {'ALL pdfs' if ALL else 'gold/math only'}", flush=True)
    # 1) enumerate targets up front so we know the TOTAL (the watchdog's progress denominator)
    targets = [p for p in pdfs(CORPUS) if ALL or GOLD.search(os.path.basename(p))]
    total = len(targets)
    # 2) load the resume manifest → already-done set (survives VM death because the manifest lives in GCS)
    done_set = set()
    if DONE_MANIFEST and os.path.exists(DONE_MANIFEST):
        with open(DONE_MANIFEST) as fh:
            done_set = {ln.strip() for ln in fh if ln.strip()}
    print(f"# {total} target PDFs · {len(done_set)} already done (resuming) · LIMIT={LIMIT or 'all'}", flush=True)

    def write_status(done, skipped, failed):
        if not STATUS:
            return
        try:
            tmp = STATUS + '.tmp'
            json.dump({'done': len(done_set), 'new': done, 'skipped': skipped, 'failed': failed,
                       'total': total, 'remaining': total - len(done_set)}, open(tmp, 'w'))
            os.replace(tmp, STATUS)
        except Exception:
            pass

    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered
    converter = PdfConverter(artifact_dict=create_model_dict())   # load the neural models ONCE
    mf = open(DONE_MANIFEST, 'a') if DONE_MANIFEST else None
    done = skipped = failed = 0
    for pdf in targets:
        r = rel(pdf)
        sidecar = pdf + '.marker.md'
        if r in done_set or os.path.exists(sidecar):      # resume: skip what's already recovered
            done_set.add(r); skipped += 1; continue
        ok = False
        try:
            signal.alarm(PDF_TIMEOUT)                      # a pathological PDF can't hang the whole run
            text, _ext, _imgs = text_from_rendered(converter(pdf))
            signal.alarm(0)
            if text and len(text.strip()) > 40:
                with open(sidecar, 'w') as f:
                    f.write(text)
                done += 1; ok = True
                if SIDECAR_GCS:                            # INCREMENTAL: persist this sidecar to GCS immediately
                    gcs_cp(sidecar, f"{SIDECAR_GCS}/{r}.marker.md")
            else:
                failed += 1
        except _Timeout:
            failed += 1; print(f"  ! TIMEOUT {os.path.basename(pdf)} (> {PDF_TIMEOUT}s) — skipping", flush=True)
        except Exception as e:
            failed += 1; print(f"  ! {os.path.basename(pdf)}: {type(e).__name__} {str(e)[:80]}", flush=True)
        finally:
            signal.alarm(0)
        # mark ATTEMPTED (success OR fail/timeout) so a resume never re-hits a poison PDF → no infinite loop
        done_set.add(r)
        if mf:
            mf.write(r + '\n'); mf.flush()
        write_status(done, skipped, failed)
        if ok and done % 25 == 0:
            print(f"  marker: {done} recovered ({len(done_set)}/{total} total), {skipped} cached, {failed} failed", flush=True)
        if LIMIT and done >= LIMIT:
            break
    write_status(done, skipped, failed)
    if mf:
        mf.close()
    complete = len(done_set) >= total
    print(f"# {'COMPLETE' if complete else 'partial'} — {done} new sidecars, {len(done_set)}/{total} total, {failed} failed.", flush=True)
    raise SystemExit(0 if complete else 3)               # 0=all done (loop stops), 3=more remaining (loop resumes)


if __name__ == '__main__':
    main()
