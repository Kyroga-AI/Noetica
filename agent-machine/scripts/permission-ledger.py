#!/usr/bin/env python3
"""
permission-ledger — peripheral-tier permission watcher for ~/.noetica.

Turns macOS TCC (Transparency, Consent & Control) permission state into DATABLE
governed events (~/.noetica/NOETICA.md invariant 5: grants/revocations are events,
not ambient state). Motivated by the observed real-world case: an app held
Accessibility (system-wide keystroke observation) for a ~4-week window and nothing
receipted the grant or the revocation.

Mechanism: snapshot-diff. Each run reads the user + system TCC databases (when
readable), diffs against the previous snapshot (~/.noetica/sessions/tcc-snapshot.json),
and appends noetica.permission.granted / .revoked events to the governed lane
(~/.noetica/sessions/events-YYYY-MM-DD.ndjson) in the same EventEnvelope shape as
lib/noetica-events.ts (envelope hash, tri-state, provenance claims).

FAIL-DEGRADED, NEVER FAIL-SILENT (invariant 2): reading TCC.db requires Full Disk
Access. Without it we degrade to whatever is readable and emit noetica.feature.sad
{error_code: tcc_db_unreadable} — the degradation is itself evidence.

Run once per boot / cron: python3 scripts/permission-ledger.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

NOETICA = Path(os.environ.get("NOETICA_HOME", Path.home() / ".noetica"))
SESSIONS = Path(os.environ.get("NOETICA_EVENTS_SINK", NOETICA / "sessions"))
SNAPSHOT = SESSIONS / "tcc-snapshot.json"
SPEC_VERSION = "0.1.0"
ACTOR = {"id": "tool:permission-ledger", "authority": "delegated"}

TCC_DBS = [
    ("user", Path.home() / "Library/Application Support/com.apple.TCC/TCC.db"),
    ("system", Path("/Library/Application Support/com.apple.TCC/TCC.db")),
]

# TCC service names worth ledgering (the high-consequence capabilities).
SERVICES_OF_INTEREST = {
    "kTCCServiceAccessibility": "accessibility (system-wide input observation)",
    "kTCCServiceMicrophone": "microphone",
    "kTCCServiceCamera": "camera",
    "kTCCServiceScreenCapture": "screen capture",
    "kTCCServiceSystemPolicyAllFiles": "full disk access",
    "kTCCServiceListenEvent": "input monitoring",
    "kTCCServicePostEvent": "input synthesis",
    "kTCCServiceAppleEvents": "apple events (automation)",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_hash(obj: object) -> str:
    """Hash scheme v1 (shared with ~/.noetica/bin/noetica_emit.py and lib/noetica-events.ts):
    sha256 over canonical JSON — sorted keys, compact separators, UTF-8, ensure_ascii=False —
    of the whole event with only integrity.envelope_hash removed. So integrity.redaction_applied
    is itself covered by the hash, and a ledger event verifies under `noetica_emit.py validate`."""
    return "sha256:" + hashlib.sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def emit(event_type: str, object_id: str, payload: dict) -> None:
    """EventEnvelope-conformant append, matching lib/noetica-events.ts output (scheme v1)."""
    envelope = {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "specVersion": SPEC_VERSION,
        "occurredAt": now_iso(),
        "actor": ACTOR,
        "objectId": object_id,
        "payload": payload,
    }
    # v1: integrity is part of the hashed body (only envelope_hash is excluded from its own
    # hash). Previously the hash was taken over a pre-integrity copy (scheme v0), which left
    # redaction_applied uncovered and diverged from the emitter — the post-hash-mutation class.
    envelope["integrity"] = {
        "redaction_applied": True,  # bundle ids are not sensitive per governance/redaction.json
    }
    envelope["integrity"]["envelope_hash"] = canonical_hash(envelope)
    SESSIONS.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(SESSIONS / f"events-{day}.ndjson", "a") as f:
        f.write(json.dumps(envelope) + "\n")


def feature_sad(name: str, error_code: str, note: str = "") -> None:
    emit("noetica.feature.sad", name, {
        "severity": "sad", "kind": "verdict", "tier": "peripheral",
        "error_code": error_code, **({"note": note} if note else {}),
    })


def read_tcc(scope: str, db: Path) -> dict[str, bool] | None:
    """{'<scope>:<service>:<client>': allowed} or None when unreadable (no FDA)."""
    if not db.exists():
        return None
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        # auth_value: 0 denied, 2 allowed, 3 limited (modern column; old schema used `allowed`)
        try:
            rows = con.execute("SELECT service, client, auth_value FROM access").fetchall()
        except sqlite3.OperationalError:
            rows = con.execute("SELECT service, client, allowed FROM access").fetchall()
        con.close()
    except (sqlite3.OperationalError, sqlite3.DatabaseError):
        return None
    state: dict[str, bool] = {}
    for service, client, auth in rows:
        if service in SERVICES_OF_INTEREST:
            state[f"{scope}:{service}:{client}"] = auth in (2, 3)
    return state


def main() -> int:
    current: dict[str, bool] = {}
    degraded = []
    for scope, db in TCC_DBS:
        state = read_tcc(scope, db)
        if state is None:
            degraded.append(scope)
        else:
            current.update(state)

    if degraded:
        feature_sad(
            "tcc_permission_ledger", "tcc_db_unreadable",
            f"scopes unreadable without Full Disk Access: {','.join(degraded)} — ledger degraded to readable scopes",
        )
    if not current and len(degraded) == len(TCC_DBS):
        print("[permission-ledger] no TCC scope readable (sad emitted) — grant Full Disk Access to enable", file=sys.stderr)
        return 0

    previous: dict[str, bool] = {}
    if SNAPSHOT.exists():
        try:
            previous = json.loads(SNAPSHOT.read_text()).get("state", {})
        except json.JSONDecodeError:
            feature_sad("tcc_permission_ledger", "snapshot_corrupt", "prior snapshot unreadable; diff baseline reset")

    changes = 0
    for key, allowed in sorted(current.items()):
        prev = previous.get(key)
        if prev is None and not previous:
            continue  # first run: baseline only, no synthetic "granted" storm
        if prev is None or prev != allowed:
            scope, service, client = key.split(":", 2)
            emit(
                "noetica.permission.granted" if allowed else "noetica.permission.revoked",
                f"{service}:{client}",
                {
                    "severity": "ok", "kind": "operation", "tier": "peripheral",
                    "claims": [{"field": "granted", "value": allowed, "provenance": "observed", "verified": True}],
                    "service_label": SERVICES_OF_INTEREST.get(service, service),
                    "scope": scope,
                },
            )
            changes += 1
    # Revocation-by-removal: a row that vanished is a revocation too.
    for key, was_allowed in sorted(previous.items()):
        if key not in current and was_allowed:
            scope, service, client = key.split(":", 2)
            emit("noetica.permission.revoked", f"{service}:{client}", {
                "severity": "ok", "kind": "operation", "tier": "peripheral",
                "claims": [{"field": "granted", "value": False, "provenance": "observed", "verified": True}],
                "service_label": SERVICES_OF_INTEREST.get(service, service),
                "scope": scope, "note": "entry removed (tccutil reset or uninstall)",
            })
            changes += 1

    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(json.dumps({"capturedAt": now_iso(), "state": current}, indent=0))
    baseline = " (baseline established)" if not previous else ""
    print(f"[permission-ledger] tracked={len(current)} changes={changes}{baseline} degraded_scopes={degraded or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
