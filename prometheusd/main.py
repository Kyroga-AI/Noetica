"""
prometheusd — Prometheus symbolic regression daemon for HellGraph.

A persistent local-first service that gives Prometheus the same collective
intelligence posture as HellGraph. Unlike the prophet-platform CLI scripts
(which are stateless batch tools), prometheusd:

  - Runs continuously alongside agent-machine (like memoryd, like the sidecar)
  - Has its own SQLite store for PlatformDynamicsCandidate history
  - Continuously pulls attention time-series from HellGraph, building a
    shared corpus across sessions — this is what makes it collective
  - Runs SINDy (fast path) and optionally PySR on aggregate dynamics data
  - Writes discovered equations back to HellGraph as first-class atoms with
    TruthValues: strength = 1 - nmse, confidence = min(n_samples / 10, 1.0)
  - Never has controlAuthority — prometheusd describes dynamics, never controls

The key architectural distinction from the CLI tools:
  CLI (prophet-platform/tools/)  →  stateless, batch, no graph identity, no PLN
  prometheusd                    →  stateful, continuous, atoms in graph, PLN-integrated

Port: 8890 (PROMETHEUSD_PORT env var)
DB:   ~/.noetica/prometheusd.db  (PROMETHEUSD_DB env var)
"""
from __future__ import annotations

import os
import sys
import json
import sqlite3
import hashlib
import asyncio
import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Prometheus SINDy fast-path (from prophet-platform/tools/) ─────────────────
_PROMETHEUS_TOOLS = Path(__file__).parent.parent.parent / "prophet-platform" / "tools"
_SINDY_AVAILABLE = False
_finite_difference = None
_fit_linear_dynamics = None

if _PROMETHEUS_TOOLS.exists():
    sys.path.insert(0, str(_PROMETHEUS_TOOLS))
    try:
        from prometheus_sindy_fast_path import (  # type: ignore
            finite_difference as _finite_difference,
            fit_linear_dynamics as _fit_linear_dynamics,
        )
        _SINDY_AVAILABLE = True
    except Exception:
        pass

# ── PySR (optional — larger install) ─────────────────────────────────────────
_PYSR_AVAILABLE = False
try:
    import pysr  # type: ignore  # noqa: F401
    _PYSR_AVAILABLE = True
except ImportError:
    pass

# ── Config ────────────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PROMETHEUSD_PORT", "8890"))
DB_PATH = Path(os.environ.get("PROMETHEUSD_DB", Path.home() / ".noetica" / "prometheusd.db"))
AM_URL = os.environ.get("AGENT_MACHINE_URL", "http://127.0.0.1:8080").rstrip("/")

SINDY_MIN_SAMPLES = 3
SINDY_GOOD_NMSE   = 0.10   # below this → candidate is promoted
POLICY_ID         = "policy://prometheusd/sindy@0.1.0"

# ── SQLite store ───────────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS attention_snapshots (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            epoch_ms   INTEGER NOT NULL,
            avg_sti    REAL    NOT NULL,
            atom_count INTEGER NOT NULL,
            session_id TEXT,
            recorded_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sr_candidates (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id   TEXT UNIQUE NOT NULL,
            method_family  TEXT NOT NULL,
            state_variable TEXT NOT NULL,
            equation_latex TEXT NOT NULL,
            coefficient    REAL,
            intercept      REAL,
            nmse           REAL NOT NULL,
            sample_count   INTEGER NOT NULL,
            strength       REAL NOT NULL,
            confidence     REAL NOT NULL,
            graph_atom_id  TEXT,
            issued_at      TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


# ── SINDy runner ───────────────────────────────────────────────────────────────

def _now_utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _run_sindy(series: list[tuple[float, float]], state_variable: str, dataset_uri: str) -> dict[str, Any]:
    if not _SINDY_AVAILABLE:
        raise RuntimeError("SINDy not available — check prophet-platform/tools installation")
    if len(series) < SINDY_MIN_SAMPLES:
        raise ValueError(f"SINDy requires at least {SINDY_MIN_SAMPLES} samples, got {len(series)}")

    derivative_points = _finite_difference(series)  # type: ignore[call-arg]
    coefficient, intercept, nmse = _fit_linear_dynamics(derivative_points)  # type: ignore[call-arg]
    equation = f"d{state_variable}/dt = {coefficient:.12g} {state_variable} + {intercept:.12g}"

    series_hash = hashlib.sha256(str(series).encode()).hexdigest()[:16]
    n = len(series)
    strength = max(0.0, 1.0 - nmse)
    confidence = min(n / 10.0, 1.0)

    return {
        "artifactType": "PlatformDynamicsCandidate",
        "applicationMode": "platform_dynamics",
        "candidateId": f"urn:prometheus:platform-dynamics-candidate:{series_hash}",
        "methodFamily": "sindy",
        "implementationMode": "sindy_linear_fast_path",
        "datasetRef": {
            "uri": dataset_uri,
            "contentHash": series_hash,
            "hashAlgorithm": "sha256_prefix",
        },
        "timeColumn": "t",
        "stateVariable": state_variable,
        "equationLatex": equation,
        "coefficient": coefficient,
        "intercept": intercept,
        "fitMetric": {"name": "nmse", "value": nmse},
        "complexity": 3,
        "unitsStatus": "unknown",
        "promotionState": "candidate" if nmse > SINDY_GOOD_NMSE else "promoted",
        "controlAuthority": False,
        "nonAuthorityDeclaration": (
            "This is a PlatformDynamicsCandidate only. It is not an autoscaling policy, "
            "routing policy, remediation policy, controller, or runtime authority."
        ),
        "issuedAt": _now_utc(),
        "sampleCount": n,
        # PLN-compatible TruthValue: strength = fitness, confidence = data quantity
        "truthValue": {"strength": round(strength, 4), "confidence": round(confidence, 4)},
        "policyId": POLICY_ID,
    }


def _persist_candidate(conn: sqlite3.Connection, c: dict[str, Any]) -> None:
    conn.execute("""
        INSERT OR REPLACE INTO sr_candidates
            (candidate_id, method_family, state_variable, equation_latex,
             coefficient, intercept, nmse, sample_count, strength, confidence,
             graph_atom_id, issued_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        c["candidateId"], c["methodFamily"], c["stateVariable"], c["equationLatex"],
        c.get("coefficient"), c.get("intercept"),
        c["fitMetric"]["value"], c["sampleCount"],
        c["truthValue"]["strength"], c["truthValue"]["confidence"],
        c.get("graph_atom_id"),
        c["issuedAt"],
    ))
    conn.commit()


# ── Ingest candidate back into HellGraph via agent-machine ────────────────────

async def _write_candidate_to_hellgraph(candidate: dict[str, Any]) -> str | None:
    """POST the candidate to agent-machine as a graph ingest event."""
    try:
        import urllib.request
        payload = json.dumps({
            "type": "prometheus_candidate",
            "candidate": candidate,
        }).encode()
        req = urllib.request.Request(
            f"{AM_URL}/api/graph/ingest",
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read())
            return body.get("nodeId")
    except Exception:
        return None


# ── Pull attention snapshots from HellGraph ───────────────────────────────────

async def _pull_attention_snapshots() -> list[dict[str, Any]]:
    """Query agent-machine for AttentionSnapshot nodes."""
    try:
        import urllib.request
        from urllib.parse import urlencode
        params = urlencode({"q": "attention snapshot avg_sti", "patterns": "attention_snapshots", "maxTokens": "2000"})
        req = urllib.request.Request(f"{AM_URL}/api/graph/query?{params}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read())
            return body.get("snapshots", [])
    except Exception:
        return []


# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="prometheusd — Prometheus SR daemon", version="0.1.0")


class AttentionSnapshotPayload(BaseModel):
    epoch_ms: int
    avg_sti: float
    atom_count: int
    session_id: str | None = None


class SINDySeriesPoint(BaseModel):
    t: float
    y: float


class SINDyRunPayload(BaseModel):
    series: list[SINDySeriesPoint]
    state_variable: str = "avg_sti"
    dataset_uri: str = "urn:hellgraph:ecan-attention-series"
    write_to_graph: bool = True


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    conn = _get_db()
    snap_count = conn.execute("SELECT COUNT(*) FROM attention_snapshots").fetchone()[0]
    cand_count = conn.execute("SELECT COUNT(*) FROM sr_candidates").fetchone()[0]
    conn.close()
    return {
        "ok": True,
        "service": "prometheusd",
        "version": app.version,
        "capabilities": {
            "sindy": _SINDY_AVAILABLE,
            "pysr": _PYSR_AVAILABLE,
        },
        "store": {
            "attention_snapshots": snap_count,
            "sr_candidates": cand_count,
            "db_path": str(DB_PATH),
        },
        "agent_machine_url": AM_URL,
    }


@app.post("/attention/record")
def record_snapshot(payload: AttentionSnapshotPayload) -> dict[str, Any]:
    """Record one attention snapshot from HellGraph."""
    conn = _get_db()
    conn.execute("""
        INSERT INTO attention_snapshots (epoch_ms, avg_sti, atom_count, session_id, recorded_at)
        VALUES (?,?,?,?,?)
    """, (payload.epoch_ms, payload.avg_sti, payload.atom_count, payload.session_id, _now_utc()))
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM attention_snapshots").fetchone()[0]
    conn.close()
    return {"ok": True, "total_snapshots": count}


@app.post("/sindy/run")
async def sindy_run(payload: SINDyRunPayload) -> dict[str, Any]:
    """Run SINDy on a provided series. Persists the candidate and optionally writes to HellGraph."""
    if not _SINDY_AVAILABLE:
        raise HTTPException(status_code=503, detail="SINDy not available — prophet-platform/tools not found")
    raw = sorted([(p.t, p.y) for p in payload.series], key=lambda x: x[0])
    try:
        candidate = _run_sindy(raw, payload.state_variable, payload.dataset_uri)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    conn = _get_db()
    _persist_candidate(conn, candidate)
    conn.close()

    graph_atom_id = None
    if payload.write_to_graph:
        graph_atom_id = await _write_candidate_to_hellgraph(candidate)
        if graph_atom_id:
            candidate["graph_atom_id"] = graph_atom_id
            conn = _get_db()
            conn.execute("UPDATE sr_candidates SET graph_atom_id=? WHERE candidate_id=?",
                         (graph_atom_id, candidate["candidateId"]))
            conn.commit()
            conn.close()

    return candidate


@app.post("/sindy/auto")
async def sindy_auto() -> dict[str, Any]:
    """Pull all stored attention snapshots and run SINDy on the aggregate series.

    This is the collective-intelligence path: data from multiple sessions is pooled,
    SINDy discovers the governing decay equation across the full history.
    """
    if not _SINDY_AVAILABLE:
        raise HTTPException(status_code=503, detail="SINDy not available")

    conn = _get_db()
    rows = conn.execute(
        "SELECT epoch_ms, avg_sti FROM attention_snapshots ORDER BY epoch_ms ASC"
    ).fetchall()
    conn.close()

    if len(rows) < SINDY_MIN_SAMPLES:
        return {
            "ok": False,
            "reason": f"Insufficient data: {len(rows)} snapshots, need {SINDY_MIN_SAMPLES}",
            "snapshot_count": len(rows),
        }

    series = [(r[0] / 1000.0, r[1]) for r in rows]  # epoch_ms → seconds
    try:
        candidate = _run_sindy(series, "avg_sti", "urn:hellgraph:ecan-attention-series:aggregate")
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    conn = _get_db()
    _persist_candidate(conn, candidate)
    conn.close()

    graph_atom_id = await _write_candidate_to_hellgraph(candidate)
    if graph_atom_id:
        candidate["graph_atom_id"] = graph_atom_id
        conn = _get_db()
        conn.execute("UPDATE sr_candidates SET graph_atom_id=? WHERE candidate_id=?",
                     (graph_atom_id, candidate["candidateId"]))
        conn.commit()
        conn.close()

    return candidate


@app.get("/candidates")
def list_candidates(limit: int = 20) -> dict[str, Any]:
    """Return the most recent SR candidates from the local store."""
    conn = _get_db()
    rows = conn.execute("""
        SELECT candidate_id, method_family, state_variable, equation_latex,
               coefficient, intercept, nmse, sample_count, strength, confidence,
               graph_atom_id, issued_at
        FROM sr_candidates ORDER BY id DESC LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return {
        "candidates": [
            {
                "candidate_id": r[0],
                "method_family": r[1],
                "state_variable": r[2],
                "equation_latex": r[3],
                "coefficient": r[4],
                "intercept": r[5],
                "nmse": r[6],
                "sample_count": r[7],
                "truthValue": {"strength": r[8], "confidence": r[9]},
                "graph_atom_id": r[10],
                "issued_at": r[11],
            }
            for r in rows
        ],
        "total": len(rows),
    }


@app.get("/candidates/latest")
def latest_candidate() -> dict[str, Any]:
    """Return the most recently issued candidate, or 404 if none."""
    conn = _get_db()
    row = conn.execute("""
        SELECT candidate_id, method_family, state_variable, equation_latex,
               coefficient, intercept, nmse, sample_count, strength, confidence,
               graph_atom_id, issued_at
        FROM sr_candidates ORDER BY id DESC LIMIT 1
    """).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No SR candidates yet")
    return {
        "candidate_id": row[0],
        "method_family": row[1],
        "state_variable": row[2],
        "equation_latex": row[3],
        "coefficient": row[4],
        "intercept": row[5],
        "nmse": row[6],
        "sample_count": row[7],
        "truthValue": {"strength": row[8], "confidence": row[9]},
        "graph_atom_id": row[10],
        "issued_at": row[11],
    }


@app.on_event("startup")
async def _startup() -> None:
    _get_db().close()  # ensure DB and schema exist


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)
