#!/usr/bin/env python3
"""
raptor_build.py - RAPTOR-style hierarchical cluster-summarization over the
MIT-OCW vector brain (arXiv:2401.18059, "RAPTOR: Recursive Abstractive
Processing for Tree-Organized Retrieval").

Builds a 2-level tree of abstractive summaries on top of a field's leaf chunks:

    Level 0  : raw chunks (the brain, already vectorized)
    Level 1  : MiniBatchKMeans over chunk vectors -> Ollama summary per cluster
    Level 2  : MiniBatchKMeans over L1 summary vectors -> Ollama summary again

Each summary node is embedded (nomic-embed-text, 768-d) and written to
    <OCW_BRAIN>/<field>.raptor.jsonl
in the SAME row schema as brain chunks, so the bench can load summary nodes as
extra retrievable items and let mid/high-abstraction nodes win retrieval for
broad questions.

Dependencies: numpy, scikit-learn, stdlib (urllib, json, base64). No cloud APIs;
only local Ollama at OLLAMA_HOST (default http://127.0.0.1:11434).

Usage:
    OLLAMA_HOST=http://127.0.0.1:11434 \\
        python3 scripts/raptor_build.py earth_planetary --cap 4000

Env:
    OCW_BRAIN    brain root (default ~/Downloads/MIT OCW/_brain)
    OLLAMA_HOST  Ollama base URL (default http://127.0.0.1:11434)
    MMLU_MODEL   summarization model (default llama3.2:3b)
    RAPTOR_EMBED_MODEL  embedding model (default nomic-embed-text)
"""

import os
import sys
import json
import math
import time
import base64
import random
import argparse
import urllib.request
import urllib.error

import numpy as np

try:
    from sklearn.cluster import MiniBatchKMeans
except Exception as e:  # pragma: no cover
    sys.stderr.write("FATAL: scikit-learn is required (pip install scikit-learn): %s\n" % e)
    sys.exit(2)


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------

DIMS = 768
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
GEN_MODEL = os.environ.get("MMLU_MODEL", "llama3.2:3b")
EMBED_MODEL = os.environ.get("RAPTOR_EMBED_MODEL", "nomic-embed-text")
OLLAMA_TIMEOUT = 12.0          # seconds per call, per spec
OLLAMA_RETRIES = 1            # one retry on failure
SAMPLE_TEXTS_PER_CLUSTER = 12  # cap concatenated member texts per cluster
TEXT_CHAR_CAP = 700            # truncate each member text to keep prompts small

FIELDS = [
    "biology", "chemistry", "physics", "mathematics",
    "eecs", "biological_eng", "earth_planetary",
]


def brain_root() -> str:
    return os.path.expanduser(os.environ.get("OCW_BRAIN", "~/Downloads/MIT OCW/_brain"))


# ----------------------------------------------------------------------------
# Ollama (local only, robust)
# ----------------------------------------------------------------------------

def _post_json(path: str, payload: dict, timeout: float = OLLAMA_TIMEOUT):
    """POST JSON to local Ollama; return parsed dict or None on any failure."""
    url = OLLAMA_HOST + path
    data = json.dumps(payload).encode("utf-8")
    last_err = None
    for attempt in range(OLLAMA_RETRIES + 1):
        try:
            req = urllib.request.Request(
                url, data=data, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - we deliberately swallow everything
            last_err = e
            time.sleep(0.4 * (attempt + 1))
    if last_err is not None:
        sys.stderr.write("  [ollama] %s failed: %r\n" % (path, last_err))
    return None


def ollama_alive() -> bool:
    try:
        with urllib.request.urlopen(OLLAMA_HOST + "/api/tags", timeout=5.0) as resp:
            return resp.status == 200
    except Exception:
        return False


def summarize(texts) -> str:
    """Ask local Ollama for a concise 2-4 sentence factual cluster summary.
    Returns "" on failure (caller falls back to a stub)."""
    joined = "\n\n---\n\n".join(t[:TEXT_CHAR_CAP] for t in texts if t)
    if not joined.strip():
        return ""
    prompt = (
        "Below are excerpts from MIT course materials that were grouped together "
        "because they cover a shared topic. Write a concise, factual 2-4 sentence "
        "summary describing the common subject matter. State the topic and the key "
        "concepts; do not mention that these are excerpts or that they were grouped.\n\n"
        "EXCERPTS:\n" + joined + "\n\nSUMMARY:"
    )
    out = _post_json("/api/generate", {
        "model": GEN_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 220},
    })
    if not out:
        return ""
    return (out.get("response") or "").strip()


def embed(text: str):
    """Embed text via Ollama; return float32[DIMS] unit-normalized, or None."""
    out = _post_json("/api/embeddings", {"model": EMBED_MODEL, "prompt": text})
    if not out:
        return None
    vec = out.get("embedding")
    if not vec:
        return None
    v = np.asarray(vec, dtype=np.float32)
    if v.shape[0] != DIMS:
        # nomic-embed-text is 768-d; guard against a model mismatch.
        if v.shape[0] > DIMS:
            v = v[:DIMS]
        else:
            v = np.pad(v, (0, DIMS - v.shape[0]))
    return _unit(v)


# ----------------------------------------------------------------------------
# Brain I/O
# ----------------------------------------------------------------------------

def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        return v.astype(np.float32)
    return (v / n).astype(np.float32)


def decode_vec(b64: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype=np.float32)


def b64_vec(v: np.ndarray) -> str:
    return base64.b64encode(np.asarray(v, dtype=np.float32).tobytes()).decode("ascii")


def load_field(field: str, cap: int):
    """Load (texts, vecs) for a field. Vectors are unit-normalized. Subsamples
    to <=cap with a fixed seed for reproducibility."""
    fdir = os.path.join(brain_root(), field)
    if not os.path.isdir(fdir):
        raise SystemExit("field dir not found: %s" % fdir)
    files = sorted(f for f in os.listdir(fdir) if f.endswith(".jsonl"))
    if not files:
        raise SystemExit("no .jsonl files in %s" % fdir)

    texts, vecs = [], []
    for fn in files:
        path = os.path.join(fdir, fn)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        o = json.loads(line)
                    except Exception:
                        continue
                    t = o.get("text")
                    b = o.get("vec")
                    if not t or not b:
                        continue
                    try:
                        v = decode_vec(b)
                    except Exception:
                        continue
                    if v.shape[0] != DIMS:
                        continue
                    texts.append(t)
                    vecs.append(_unit(v))
        except Exception as e:  # noqa: BLE001
            sys.stderr.write("  [load] skipped %s: %r\n" % (fn, e))

    n = len(texts)
    if n == 0:
        raise SystemExit("no usable chunks found in %s" % field)

    if cap and n > cap:
        rng = random.Random(1729)
        idx = rng.sample(range(n), cap)
        texts = [texts[i] for i in idx]
        vecs = [vecs[i] for i in idx]

    return texts, np.vstack(vecs).astype(np.float32)


# ----------------------------------------------------------------------------
# Clustering + summarization
# ----------------------------------------------------------------------------

def cluster(vecs: np.ndarray, k: int):
    """MiniBatchKMeans -> labels array. k is clamped to [1, n]."""
    n = vecs.shape[0]
    k = max(1, min(k, n))
    if k == 1:
        return np.zeros(n, dtype=int), k
    km = MiniBatchKMeans(
        n_clusters=k, random_state=1729, batch_size=max(256, k * 4),
        n_init=3, max_iter=120,
    )
    labels = km.fit_predict(vecs)
    return labels, k


def build_level(level: int, field: str, texts, vecs, k: int):
    """Cluster, summarize each cluster via Ollama, embed each summary.
    Returns list of node dicts: {level,id,text,dims,vec(np),members}."""
    labels, k_eff = cluster(vecs, k)
    print("  level %d: clustering %d items into %d clusters..."
          % (level, len(texts), k_eff), flush=True)

    rng = random.Random(1729)
    nodes = []
    for c in range(k_eff):
        members = [i for i, lab in enumerate(labels) if lab == c]
        if not members:
            continue
        sample = members if len(members) <= SAMPLE_TEXTS_PER_CLUSTER else \
            rng.sample(members, SAMPLE_TEXTS_PER_CLUSTER)
        member_texts = [texts[i] for i in sample]

        summary = ""
        try:
            summary = summarize(member_texts)
        except Exception as e:  # noqa: BLE001 - one bad cluster never kills the build
            sys.stderr.write("  [summarize] cluster %d failed: %r\n" % (c, e))

        if not summary:
            # Graceful stub: keep the node so clustering output is still usable.
            head = (member_texts[0] or "").strip().replace("\n", " ")
            summary = ("[stub: %d members] " % len(members)) + head[:240]

        # Embed the summary. Fall back to the cluster centroid if embed fails,
        # so every node still carries a valid 768-d vector loadable by the bench.
        evec = None
        try:
            evec = embed(summary)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write("  [embed] cluster %d failed: %r\n" % (c, e))
        if evec is None:
            evec = _unit(vecs[members].mean(axis=0))

        nodes.append({
            "level": level,
            "id": "%s:L%d:%d" % (field, level, len(nodes)),
            "text": summary,
            "dims": DIMS,
            "vec": evec,            # np array here; serialized to b64 on write
            "members": len(members),
        })
        print("    cluster %d/%d -> %d members, summary %d chars"
              % (c + 1, k_eff, len(members), len(summary)), flush=True)

    return nodes


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="RAPTOR hierarchical summarization over the OCW brain")
    ap.add_argument("field", nargs="?", default="earth_planetary",
                    help="field/subdir to process (default: earth_planetary)")
    ap.add_argument("--cap", type=int, default=6000,
                    help="subsample chunks to at most N for speed (default 6000)")
    args = ap.parse_args()

    field = args.field
    if field not in FIELDS:
        sys.stderr.write("warning: '%s' not in known fields %s; proceeding anyway\n"
                         % (field, FIELDS))

    print("RAPTOR build  field=%s  cap=%d" % (field, args.cap))
    print("  brain=%s" % brain_root())
    print("  ollama=%s  gen=%s  embed=%s" % (OLLAMA_HOST, GEN_MODEL, EMBED_MODEL))

    alive = ollama_alive()
    if not alive:
        print("  WARNING: Ollama unreachable at %s -- summaries will be STUBBED "
              "and vectors will use cluster centroids." % OLLAMA_HOST)

    t0 = time.time()
    texts, vecs = load_field(field, args.cap)
    n = len(texts)
    print("  loaded %d chunks (%.1fs)" % (n, time.time() - t0))

    # Level 1: over chunk vectors.
    k1 = max(8, int(math.sqrt(n)))
    l1 = build_level(1, field, texts, vecs, k1)

    # Level 2: over L1 summary vectors.
    if l1:
        l1_texts = [nd["text"] for nd in l1]
        l1_vecs = np.vstack([nd["vec"] for nd in l1]).astype(np.float32)
        k2 = max(4, int(math.sqrt(len(l1))))
        l2 = build_level(2, field, l1_texts, l1_vecs, k2)
    else:
        l2 = []

    # Write output: same schema as brain chunks.
    out_path = os.path.join(brain_root(), "%s.raptor.jsonl" % field)
    written = 0
    with open(out_path, "w", encoding="utf-8") as fh:
        for nd in (l1 + l2):
            row = {
                "level": nd["level"],
                "id": nd["id"],
                "text": nd["text"],
                "dims": DIMS,
                "vec": b64_vec(nd["vec"]),
                "members": nd["members"],
            }
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            written += 1

    # ---- Self-test / validation -------------------------------------------
    n_l1, n_l2 = len(l1), len(l2)
    n_sum = n_l1 + n_l2
    ratio = (n / n_sum) if n_sum else float("nan")
    stubbed = sum(1 for nd in (l1 + l2) if nd["text"].startswith("[stub:"))

    print("\n==================== RAPTOR TREE STATS ====================")
    print("  field                : %s" % field)
    print("  N chunks (level 0)   : %d" % n)
    print("  L1 summaries         : %d  (k=%d requested)" % (n_l1, k1))
    print("  L2 summaries         : %d" % n_l2)
    print("  total summary nodes  : %d" % n_sum)
    print("  compression ratio    : %.1fx  (chunks -> summaries)" % ratio)
    print("  stubbed nodes        : %d  (Ollama unavailable/failed)" % stubbed)
    print("  output               : %s  (%d rows)" % (out_path, written))
    print("  elapsed              : %.1fs" % (time.time() - t0))

    # Sanity: reload the file the way the bench would, to prove it's loadable.
    try:
        with open(out_path, "r", encoding="utf-8") as fh:
            first = json.loads(fh.readline())
        rv = decode_vec(first["vec"])
        print("  reload check         : OK  (row id=%s, vec dims=%d)"
              % (first["id"], rv.shape[0]))
    except Exception as e:  # noqa: BLE001
        print("  reload check         : FAILED: %r" % e)

    # Show 2 example summaries (prefer real, non-stub ones).
    examples = [nd for nd in (l2 + l1) if not nd["text"].startswith("[stub:")][:2]
    if len(examples) < 2:
        examples = (l2 + l1)[:2]
    print("\n-------------------- EXAMPLE SUMMARIES --------------------")
    for nd in examples:
        snippet = nd["text"].replace("\n", " ").strip()
        print("  [%s | %d members]\n    %s\n" % (nd["id"], nd["members"], snippet[:500]))

    print("==========================================================")


if __name__ == "__main__":
    main()
