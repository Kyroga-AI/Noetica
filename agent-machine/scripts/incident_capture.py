#!/usr/bin/env python3
"""
incident_capture — the executable seed of incident-memory-and-self-healing.md.

Capture every failure as a FailureAtom, cluster co-occurring failures into Incidents by a time
window, correlate across symbols (the empirical failure-dependency graph), tag a resolved
incident with its solution, and retrieve the nearest past incident for a new symptom. No DB yet —
JSONL at ~/.noetica/incidents.jsonl — so the memory starts accumulating TODAY and can be ingested
into hellgraph atoms later without changing the capture path.

The point of starting here: the gate (verify_action.py) decides what may run; this records what
went wrong and how it was fixed. Together they are the minimum viable self-healing loop — every
NEG verdict and every stderr becomes durable, findable troubleshooting memory.

Run:  python3 scripts/incident_capture.py     # seed a synthetic cascade, cluster, correlate, retrieve
"""
import sys, os, json, time, re

STORE = os.path.expanduser("~/.noetica/incidents.jsonl")

# Symbol extractors — turn raw failure text into typed symbols the graph correlates on.
EXTRACT = [
    ("err",    re.compile(r"\b(E[A-Z]{3,}|ETIMEDOUT|ECONNREFUSED|ENOENT|EACCES|OOM|SIG[A-Z]+)\b")),
    ("http",   re.compile(r"\b([45]\d\d)\b")),
    ("port",   re.compile(r"(?:port\s+|:)(\d{2,5})\b")),
    ("svc",    re.compile(r"\b([a-z][a-z0-9_-]*\.service|prometheusd|ollama|noetica\w*|hellgraph\w*|[a-z][a-z0-9_]{2,}d)\b")),
    ("file",   re.compile(r"(/[\w./-]+\.\w+)")),
    ("exit",   re.compile(r"\bexit(?:\s+code)?\s+(\d+)\b")),
]
# the trailing "<name>d" heuristic catches daemons but also English words ending in -d; drop those.
SVC_STOP = {"could", "would", "should", "crashed", "reached", "learned", "named", "killed",
            "failed", "passed", "missed", "closed", "opened", "loaded", "needed", "tried",
            "exited", "blocked", "stored", "expired", "denied", "skipped", "wired"}


def extract_symbols(text):
    syms = set()
    for kind, pat in EXTRACT:
        for m in pat.findall(text or ""):
            if kind == "svc" and m.lower() in SVC_STOP:
                continue
            syms.add(f"{kind}:{m}")
    return sorted(syms)


def capture(symptom, source="stderr", severity="error", context=None, ts=None):
    """Record one FailureAtom. source='gate-NEG' for the agent's own failed actions."""
    atom = {
        "label": "FailureAtom", "tier": "incident",
        "ts": ts if ts is not None else time.time(),
        "symptom": symptom, "symbols": extract_symbols(symptom),
        "severity": severity, "source": source, "context": context or {},
        "status": "open",
    }
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    with open(STORE, "a") as f:
        f.write(json.dumps(atom, sort_keys=True) + "\n")
    return atom


def _load():
    if not os.path.exists(STORE):
        return []
    return [json.loads(l) for l in open(STORE) if l.strip()]


def _jaccard(a, b):
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if (a or b) else 0.0


def cluster_incidents(window_s=120, atoms=None):
    """Group failures into Incidents: same time window AND ≥1 shared symbol → one incident
    (a cascade is one incident, not three). Returns list of incidents."""
    atoms = sorted(atoms if atoms is not None else _load(), key=lambda a: a["ts"])
    incidents = []
    for a in atoms:
        placed = False
        for inc in incidents:
            if (a["ts"] - inc["window"]["end"] <= window_s
                    and (set(a["symbols"]) & set(inc["signature"]))):
                inc["members"].append(a)
                inc["window"]["end"] = a["ts"]
                inc["signature"] = sorted(set(inc["signature"]) | set(a["symbols"]))
                placed = True
                break
        if not placed:
            incidents.append({"window": {"start": a["ts"], "end": a["ts"]},
                              "members": [a], "signature": sorted(a["symbols"]),
                              "status": "open", "resolved_by": None})
    return incidents


def correlate(incidents=None):
    """Empirical failure-dependency graph: how often each symbol pair co-occurs in an incident,
    with lift over independent co-occurrence. High lift = a real coupling worth a contract."""
    incidents = incidents if incidents is not None else cluster_incidents()
    from itertools import combinations
    from collections import Counter
    sym_count, pair_count = Counter(), Counter()
    for inc in incidents:
        sig = sorted(set(inc["signature"]))
        for s in sig:
            sym_count[s] += 1
        for x, y in combinations(sig, 2):
            pair_count[(x, y)] += 1
    n = max(len(incidents), 1)
    edges = []
    for (x, y), c in pair_count.items():
        exp = (sym_count[x] / n) * (sym_count[y] / n) * n
        lift = c / exp if exp else float("inf")
        edges.append({"a": x, "b": y, "cooccur": c, "lift": round(lift, 2)})
    return sorted(edges, key=lambda e: (-e["cooccur"], -e["lift"]))


def tag_solution(incident, skill, evidence=None):
    """Resolve an incident: link it to the Skill that fixed it (+ the gate's verification)."""
    incident["status"] = "resolved"
    incident["resolved_by"] = skill
    incident["resolution_evidence"] = evidence or {}
    return incident


def find_similar(symptom, incidents=None, k=3):
    """Future troubleshooting: a new symptom → nearest past incidents by symbol overlap,
    resolved ones first (their tagged Skill is the candidate fix)."""
    syms = extract_symbols(symptom)
    incidents = incidents if incidents is not None else cluster_incidents()
    scored = [(round(_jaccard(syms, inc["signature"]), 3), inc) for inc in incidents]
    scored = [s for s in scored if s[0] > 0]
    scored.sort(key=lambda s: (s[1]["status"] == "resolved", s[0]), reverse=True)
    return scored[:k]


def main():
    # Fresh demo store so the self-test is deterministic.
    global STORE
    STORE = os.path.expanduser("~/.noetica/incidents-demo.jsonl")
    if os.path.exists(STORE):
        os.remove(STORE)

    t0 = time.time()
    print("# incident_capture self-test — synthetic cascade → cluster → correlate → retrieve\n")
    # A cascade: prometheusd dies → connection refused on its port → a dependent job exits non-zero.
    capture("prometheusd crashed (SIGABRT) writing /opt/.noetica/prometheusd.db", "stderr", "fatal", ts=t0)
    capture("ECONNREFUSED connecting to prometheusd on port 8890", "stderr", "error", ts=t0 + 5)
    capture("discovery job exit code 1: could not reach prometheusd:8890", "gate-NEG", "error", ts=t0 + 9)
    # An unrelated, much-later failure → must NOT join the cascade incident.
    capture("ETIMEDOUT pulling gs://sourceos-artifacts/ocw-corpus", "stderr", "warn", ts=t0 + 900)

    incidents = cluster_incidents(window_s=120)
    print(f"  {len(incidents)} incident(s) from 4 failures (cascade collapses to one):")
    for i, inc in enumerate(incidents):
        secs = inc["window"]["end"] - inc["window"]["start"]
        print(f"   #{i+1}  {len(inc['members'])} failures · {secs:.0f}s window · sig={inc['signature']}")

    print("\n  correlation edges (empirical failure-dependency graph):")
    for e in correlate(incidents)[:5]:
        print(f"   {e['a']:16} ↔ {e['b']:22} cooccur={e['cooccur']} lift={e['lift']}")

    # Resolve the cascade, then prove a NEW similar symptom finds the tagged fix.
    tag_solution(incidents[0], "Skill:restart-prometheusd",
                 evidence={"postcondition": "POS", "gate": "ALLOW"})
    print("\n  tagged incident #1 → Skill:restart-prometheusd (postcondition POS)")

    print("\n  NEW failure arrives → retrieve nearest past incident → candidate fix:")
    new = "connection refused: prometheusd not listening on 8890"
    for score, inc in find_similar(new, incidents):
        print(f"   sim={score}  status={inc['status']:8}  fix={inc['resolved_by']}  sig⊇{inc['signature'][:3]}")
    print("\n  → the brain already knows this one: propose Skill:restart-prometheusd through the gate.")


if __name__ == "__main__":
    main()
