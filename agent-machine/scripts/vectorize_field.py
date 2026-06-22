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
import os, sys, json, base64, struct, urllib.request

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
OLLAMA = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
MODEL = os.environ.get('EMBED_MODEL', 'nomic-embed-text')
FIELD = sys.argv[1] if len(sys.argv) > 1 else 'medicine'


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
    files = [f for f in os.listdir(fdir) if f.endswith('.jsonl')]
    done = err = skip = 0
    for fn in files:
        fp = os.path.join(fdir, fn)
        lines = open(fp, errors='replace').read().splitlines()
        out = []
        for ln in lines:
            if not ln.strip():
                continue
            try:
                o = json.loads(ln)
            except Exception:
                continue
            if o.get('vec'):                      # already embedded — keep as-is (idempotent)
                out.append(ln); skip += 1; continue
            text = (o.get('text') or '').strip()
            if not text:
                continue
            try:
                v = embed(text)
                if not v:
                    raise ValueError('empty embedding')
                o['vec'], o['dims'] = pack(v)
                out.append(json.dumps(o)); done += 1
                if done % 500 == 0:
                    sys.stderr.write(f'  {FIELD}: embedded {done} (skip {skip}, err {err})\n')
            except Exception:
                err += 1
        with open(fp, 'w') as w:
            w.write('\n'.join(out) + ('\n' if out else ''))
        print(f'# {fn}: embedded {done} · skipped {skip} · errors {err}', flush=True)
    print(f'# {FIELD} vectorized: {done} new vectors ({skip} already done, {err} errors). '
          f'study-brain can now retrieve over the {FIELD} field.')


if __name__ == '__main__':
    main()
