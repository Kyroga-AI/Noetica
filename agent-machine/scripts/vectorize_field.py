#!/usr/bin/env python3
"""
vectorize_field — embed a brain field's text chunks into loadable brain shards (step 2 of medical
readiness; reusable for any field). Reads <OCW_BRAIN>/<field>/*.jsonl chunks {text, slug, field, …},
embeds each text with the SAME embedder the brain uses (nomic-embed-text, 768-d, via Ollama), and adds
a base64 float32 `vec` + `dims` IN PLACE — the exact format lib/study-brain.ts loadField() expects.

Idempotent: chunks that already carry `vec` are skipped (re-runnable / resumable). Embeddings are the
expensive pass — on CPU this crawls over 100k+ snippets, so the full medicine corpus is a GPU/compute
job; MED_LIMIT / a small field is the local smoke.

Run:  OLLAMA_HOST=http://127.0.0.1:11434 python3 scripts/vectorize_field.py medicine
  OCW_BRAIN  brain dir (default ~/Downloads/MIT OCW/_brain)
  EMBED_MODEL  embedder (default nomic-embed-text — MUST match the rest of the brain)
"""
import os, sys, json, base64, struct, urllib.request, threading
from concurrent.futures import ThreadPoolExecutor

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
OLLAMA = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
MODEL = os.environ.get('EMBED_MODEL', 'nomic-embed-text')
FIELD = sys.argv[1] if len(sys.argv) > 1 else 'medicine'
# Embeds run CONCURRENTLY — serial embed was the bottleneck (medicine: 125k chunks @ ~25/s ≈ 80 min).
# Ollama serves OLLAMA_NUM_PARALLEL embed requests at once, so a thread pool gives ~Nx. Default 8.
CONC = int(os.environ.get('BRAIN_CONCURRENCY', '8'))


def embed(text):
    body = json.dumps({'model': MODEL, 'prompt': text[:8000]}).encode()
    req = urllib.request.Request(f'{OLLAMA}/api/embeddings', body, {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        v = json.load(r).get('embedding') or []
    return v


def pack(v):
    """float list → base64 little-endian float32 (the brain's vec encoding)."""
    return base64.b64encode(struct.pack(f'<{len(v)}f', *v)).decode(), len(v)


def main():
    fdir = os.path.join(BRAIN, FIELD)
    if not os.path.isdir(fdir):
        sys.exit(f'no field dir: {fdir} (run fetch first)')
    files = [f for f in os.listdir(fdir) if f.endswith('.jsonl') and not f.endswith('.tmp')]
    n_done = err = skip = 0
    for fn in files:
        fp = os.path.join(fdir, fn)
        tmp = fp + '.tmp'
        # RESUMABLE: write embedded chunks to a .tmp incrementally (flush periodically), atomic-rename
        # at the end. A killed GPU run leaves a partial .tmp; on re-run we load its done slugs and skip
        # them — so we never lose the expensive embeddings already computed.
        done_slugs = set()
        if os.path.exists(tmp):
            for ln in open(tmp, errors='replace'):
                try:
                    done_slugs.add(json.loads(ln).get('slug'))
                except Exception:
                    pass
            print(f"# resume {fn}: {len(done_slugs)} chunks already embedded", flush=True)
        w = open(tmp, 'a')
        lock = threading.Lock()
        pending = []
        for ln in open(fp, errors='replace'):
            ln = ln.strip()
            if not ln:
                continue
            try:
                o = json.loads(ln)
            except Exception:
                continue
            slug = o.get('slug')
            if slug in done_slugs:                # already written to .tmp this/last run
                continue
            if o.get('vec'):                      # already embedded — carry over (idempotent)
                w.write(json.dumps(o) + '\n'); skip += 1; done_slugs.add(slug); continue
            if (o.get('text') or '').strip():
                pending.append(o)

        def work(o):                              # one chunk: embed + write under the lock
            nonlocal n_done, err
            try:
                v = embed((o.get('text') or '').strip())
                if not v:
                    raise ValueError('empty embedding')
                o['vec'], o['dims'] = pack(v)
                with lock:
                    w.write(json.dumps(o) + '\n'); n_done += 1
                    if n_done % 200 == 0:
                        w.flush()                 # durable every 200 → bounded loss on a hard kill
                        sys.stderr.write(f"  {FIELD}: embedded {n_done} (skip {skip}, err {err})\n")
            except Exception:
                with lock:
                    err += 1
        with ThreadPoolExecutor(max_workers=CONC) as ex:   # CONC embeds in flight (ollama serves them parallel)
            list(ex.map(work, pending))
        w.close()
        os.replace(tmp, fp)                       # atomic promote
        print(f"# {fn}: embedded {n_done} · skipped {skip} · errors {err}", flush=True)
    print(f'# {FIELD} vectorized: {n_done} new vectors ({skip} carried over, {err} errors). '
          f'study-brain can now retrieve over the {FIELD} field.')


if __name__ == '__main__':
    main()
