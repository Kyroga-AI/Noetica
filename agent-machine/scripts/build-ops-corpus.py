#!/usr/bin/env python3
"""build-ops-corpus — assemble the OPERATIONS brain from self-ops knowledge + stack docs.

The operations brain is what lets Noetica explain how to update and troubleshoot ITSELF (and the
SocioProphet / SourceOS / SociOS stack) — the local-first differentiator a hosted assistant can't match.
This writes lexical JSONL chunks into the ops brain dir (alongside manpages.jsonl); the ops-brain lane reads
every *.jsonl there.

Sources:
  1. agent-machine/data/self-ops-knowledge.md   (authored runbook/FAQ — always included)  -> self-ops.jsonl
  2. doc roots passed as args (README.md, docs/**.md, CLAUDE.md across the stack)           -> stack-docs.jsonl

Usage:
  python3 scripts/build-ops-corpus.py                       # self-ops only
  python3 scripts/build-ops-corpus.py ~/dev/Noetica ~/dev/SourceOS-Linux ~/dev/SociOS-Linux   # + stack docs
"""
import json, os, re, sys, glob

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))            # agent-machine/scripts
SELF_OPS_MD = os.path.join(os.path.dirname(HERE), "data", "self-ops-knowledge.md")

def ops_dir() -> str:
    """Mirror lib/brain-home.ts opsBrainDir(): env > canonical > legacy (create canonical if neither)."""
    env = os.environ.get("OPS_CORPUS", "").strip()
    if env:
        return os.path.dirname(env)
    for c in (os.path.join(HOME, ".noetica", "brains", "operational"),
              os.path.join(HOME, ".noetica", "ops-corpus")):
        if os.path.isdir(c):
            return c
    d = os.path.join(HOME, ".noetica", "brains", "operational")
    os.makedirs(d, exist_ok=True)
    return d

def chunk(text: str, size: int = 1200) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    if len(text) <= size:
        return [text] if text else []
    out, cur = [], ""
    for para in text.split("\n\n"):
        if len(cur) + len(para) + 2 > size and cur:
            out.append(cur.strip()); cur = ""
        cur += para + "\n\n"
    if cur.strip():
        out.append(cur.strip())
    return out

def write_jsonl(path: str, rows: list[dict]) -> None:
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

def build_self_ops() -> list[dict]:
    if not os.path.isfile(SELF_OPS_MD):
        print(f"# self-ops doc not found: {SELF_OPS_MD}"); return []
    md = open(SELF_OPS_MD).read()
    rows, idx = [], 0
    # split into "## heading\nbody" sections
    for m in re.finditer(r"^##\s+(.+?)\n(.*?)(?=^##\s+|\Z)", md, re.S | re.M):
        heading, body = m.group(1).strip(), m.group(2).strip()
        if not body:
            continue
        subject = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")[:48] or "noetica-ops"
        for c in chunk(f"{heading}\n{body}"):
            rows.append({"tier": "operational", "subject": subject, "man_section": "", "type": "faq",
                         "domain": "self-ops", "knowledge_type": "procedural", "chunk_index": idx, "text": c})
            idx += 1
    return rows

def build_stack_docs(roots: list[str]) -> list[dict]:
    rows, idx = [], 0
    seen = set()
    for root in roots:
        root = os.path.expanduser(root)
        if not os.path.isdir(root):
            print(f"# stack-docs: skip {root} (not a directory)"); continue
        proj = os.path.basename(root.rstrip("/"))
        files = []
        for pat in ("README.md", "CLAUDE.md", "docs/**/*.md", "*.md"):
            files += glob.glob(os.path.join(root, pat), recursive=True)
        for fp in sorted(set(files)):
            if "/node_modules/" in fp or fp in seen:
                continue
            seen.add(fp)
            try:
                txt = open(fp, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            rel = os.path.relpath(fp, root)
            subject = f"{proj}/{rel}"
            for c in chunk(txt):
                rows.append({"tier": "operational", "subject": subject, "man_section": "", "type": "doc",
                             "domain": "stack-docs", "knowledge_type": "reference", "chunk_index": idx, "text": c})
                idx += 1
    return rows

def main() -> None:
    out_dir = ops_dir()
    self_ops = build_self_ops()
    write_jsonl(os.path.join(out_dir, "self-ops.jsonl"), self_ops)
    print(f"# self-ops.jsonl: {len(self_ops)} chunks -> {out_dir}")

    roots = sys.argv[1:]
    if roots:
        docs = build_stack_docs(roots)
        write_jsonl(os.path.join(out_dir, "stack-docs.jsonl"), docs)
        print(f"# stack-docs.jsonl: {len(docs)} chunks from {len(roots)} root(s) -> {out_dir}")
    else:
        print("# (pass repo paths as args to also ingest stack docs: build-ops-corpus.py ~/dev/Noetica …)")

    print(f"# ops brain now has: {', '.join(sorted(f for f in os.listdir(out_dir) if f.endswith('.jsonl')))}")

if __name__ == "__main__":
    main()
