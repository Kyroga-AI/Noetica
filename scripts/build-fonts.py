#!/usr/bin/env python3
"""
Reproducible build for the Noetica typeface (Noetica Sans / Noetica Mono).

Noetica Sans/Mono are an OFL fork of IBM Plex, renamed per the Reserved Font Name
clause and delivered the sovereign way — bundled, self-hosted, no CDN, no local()
probing. This script fetches the OFL base, strips the reserved "IBM Plex" name,
and emits the woff2 files in public/fonts/. Auditable: anyone can re-run and diff.

Requires:  pip install fonttools brotli
Usage:     python3 scripts/build-fonts.py
"""
import os, sys, urllib.request
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "fonts")
CDN = "https://cdn.jsdelivr.net/npm/@fontsource"

# base OFL files (IBM Plex, latin subset) -> our renamed output
JOBS = [
    ("ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", "noetica-sans-400.woff2"),
    ("ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", "noetica-sans-600.woff2"),
    ("ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", "noetica-mono-400.woff2"),
]
# OFL: a fork MUST NOT keep the reserved "IBM Plex" name.
REPL = [("IBM Plex Sans","Noetica Sans"),("IBM Plex Mono","Noetica Mono"),
        ("IBMPlexSans","NoeticaSans"),("IBMPlexMono","NoeticaMono"),
        ("IBM Plex","Noetica"),("IBMPlex","Noetica")]

os.makedirs(OUT, exist_ok=True)
tmp = os.path.join(OUT, "_base.woff2")
for src, dst in JOBS:
    urllib.request.urlretrieve(f"{CDN}/{src}", tmp)
    f = TTFont(tmp)
    for rec in f["name"].names:
        s = rec.toUnicode()
        for a, b in REPL:
            s = s.replace(a, b)
        rec.string = s
    f.flavor = "woff2"
    f.save(os.path.join(OUT, dst))
    print(f"built {dst}  ({f['name'].getDebugName(1)})")
os.remove(tmp)
print("done →", OUT)
