// noetica-permission-ledger — peripheral-tier TCC watcher as a SELF-CONTAINED signed
// binary. Unlike scripts/permission-ledger.py (which runs under an interpreter whose
// identity TCC can't pin — python's 3-deep stub-exec defeats the Full Disk Access grant
// under launchd), this executable EXECS NOTHING: it is its own TCC principal, so a single
// FDA grant on this one binary lets the hourly launchd job actually read the permission DB.
//
// Behaviour matches the Python watcher exactly: snapshot-diff the user + system TCC
// databases, append EventEnvelope-conformant noetica.permission.{granted,revoked} events to
// ~/.noetica/sessions/events-YYYY-MM-DD.ndjson, and share the same baseline snapshot file
// (~/.noetica/sessions/tcc-snapshot.json). Fail-degraded, never fail-silent: an unreadable
// scope emits noetica.feature.sad {tcc_db_unreadable} — the blindness is itself evidence.
//
// Build:  swiftc -O native/permission-ledger.swift -o bin/noetica-permission-ledger
// Sign:   codesign -s - --identifier ai.sourceos.noetica.permission-ledger --force <bin>

import Foundation
import SQLite3
import CryptoKit

let SPEC_VERSION = "0.1.0"
let ACTOR: [String: Any] = ["id": "tool:noetica-permission-ledger", "authority": "delegated"]

let SERVICES: [String: String] = [
    "kTCCServiceAccessibility": "accessibility (system-wide input observation)",
    "kTCCServiceMicrophone": "microphone",
    "kTCCServiceCamera": "camera",
    "kTCCServiceScreenCapture": "screen capture",
    "kTCCServiceSystemPolicyAllFiles": "full disk access",
    "kTCCServiceListenEvent": "input monitoring",
    "kTCCServicePostEvent": "input synthesis",
    "kTCCServiceAppleEvents": "apple events (automation)",
]

let home = FileManager.default.homeDirectoryForCurrentUser.path
let noeticaHome = ProcessInfo.processInfo.environment["NOETICA_HOME"] ?? "\(home)/.noetica"
let sessions = ProcessInfo.processInfo.environment["NOETICA_EVENTS_SINK"] ?? "\(noeticaHome)/sessions"
let snapshotPath = "\(sessions)/tcc-snapshot.json"

let tccDBs: [(String, String)] = [
    ("user", "\(home)/Library/Application Support/com.apple.TCC/TCC.db"),
    ("system", "/Library/Application Support/com.apple.TCC/TCC.db"),
]

func nowISO() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}

// ── canonical JSON (sorted keys, compact) — used for both the emitted line and the hash ──
func canon(_ v: Any) -> String {
    switch v {
    case let d as [String: Any]:
        let parts = d.keys.sorted().map { "\(canon($0)):\(canon(d[$0]!))" }
        return "{\(parts.joined(separator: ","))}"
    case let a as [Any]:
        return "[\(a.map(canon).joined(separator: ","))]"
    case let s as String:
        let data = try! JSONSerialization.data(withJSONObject: [s], options: [])
        var str = String(data: data, encoding: .utf8)!
        str.removeFirst(); str.removeLast()   // strip the [ ]
        return str
    case let b as Bool: return b ? "true" : "false"
    case let i as Int: return String(i)
    default: return "null"
    }
}

func sha256Hex(_ s: String) -> String {
    SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

func emit(_ eventType: String, _ objectId: String, _ payload: [String: Any]) {
    var env: [String: Any] = [
        "eventId": UUID().uuidString.lowercased(),
        "eventType": eventType,
        "specVersion": SPEC_VERSION,
        "occurredAt": nowISO(),
        "actor": ACTOR,
        "objectId": objectId,
        "payload": payload,
    ]
    let hash = "sha256:" + sha256Hex(canon(env))    // hash over envelope sans integrity
    env["integrity"] = ["redaction_applied": true, "envelope_hash": hash]
    // bundle ids / paths are non-sensitive per governance/redaction.json → redaction is a no-op
    try? FileManager.default.createDirectory(atPath: sessions, withIntermediateDirectories: true)
    let day = String(nowISO().prefix(10))
    let line = canon(env) + "\n"
    let url = URL(fileURLWithPath: "\(sessions)/events-\(day).ndjson")
    if let fh = try? FileHandle(forWritingTo: url) {
        fh.seekToEndOfFile(); fh.write(line.data(using: .utf8)!); try? fh.close()
    } else {
        try? line.data(using: .utf8)!.write(to: url)
    }
}

func featureSad(_ name: String, _ code: String, _ note: String) {
    emit("noetica.feature.sad", name,
         ["severity": "sad", "kind": "verdict", "tier": "peripheral", "error_code": code, "note": note])
}

// ── read one TCC.db read-only; nil = unreadable (no FDA / missing) ──
func readTCC(_ scope: String, _ path: String) -> [String: Bool]? {
    if !FileManager.default.fileExists(atPath: path) { return nil }
    var db: OpaquePointer?
    guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        sqlite3_close(db); return nil
    }
    defer { sqlite3_close(db) }
    var state: [String: Bool] = [:]
    var probed = false
    for sql in ["SELECT service, client, auth_value FROM access",
                "SELECT service, client, allowed FROM access"] {
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) != SQLITE_OK { continue }
        probed = true
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let svcC = sqlite3_column_text(stmt, 0), let cliC = sqlite3_column_text(stmt, 1) else { continue }
            let service = String(cString: svcC)
            let client = String(cString: cliC)
            let auth = Int(sqlite3_column_int(stmt, 2))
            if SERVICES[service] != nil {
                state["\(scope):\(service):\(client)"] = (auth == 2 || auth == 3)
            }
        }
        sqlite3_finalize(stmt)
        break
    }
    return probed ? state : nil
}

// ── main ──
var current: [String: Bool] = [:]
var degraded: [String] = []
for (scope, path) in tccDBs {
    if let s = readTCC(scope, path) { current.merge(s) { _, new in new } }
    else { degraded.append(scope) }
}

if !degraded.isEmpty {
    featureSad("tcc_permission_ledger", "tcc_db_unreadable",
               "scopes unreadable without Full Disk Access: \(degraded.joined(separator: ",")) — ledger degraded")
}
if current.isEmpty && degraded.count == tccDBs.count {
    FileHandle.standardError.write("[permission-ledger] no TCC scope readable (sad emitted) — grant FDA to this binary\n".data(using: .utf8)!)
    exit(0)
}

var previous: [String: Bool] = [:]
if let data = FileManager.default.contents(atPath: snapshotPath),
   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
   let st = obj["state"] as? [String: Bool] {
    previous = st
}

func emitChange(_ key: String, _ allowed: Bool, _ note: String?) {
    let parts = key.split(separator: ":", maxSplits: 2).map(String.init)
    guard parts.count == 3 else { return }
    let (scope, service, client) = (parts[0], parts[1], parts[2])
    var payload: [String: Any] = [
        "severity": "ok", "kind": "operation", "tier": "peripheral",
        "claims": [["field": "granted", "value": allowed, "provenance": "observed", "verified": true]],
        "service_label": SERVICES[service] ?? service, "scope": scope,
    ]
    if let n = note { payload["note"] = n }
    emit(allowed ? "noetica.permission.granted" : "noetica.permission.revoked", "\(service):\(client)", payload)
}

var changes = 0
let firstRun = previous.isEmpty
for (key, allowed) in current.sorted(by: { $0.key < $1.key }) {
    if firstRun { continue }              // baseline only — no synthetic grant storm
    if let prev = previous[key] { if prev != allowed { emitChange(key, allowed, nil); changes += 1 } }
    else { emitChange(key, allowed, "new TCC entry"); changes += 1 }
}
for (key, wasAllowed) in previous.sorted(by: { $0.key < $1.key }) where current[key] == nil && wasAllowed {
    emitChange(key, false, "entry removed (tccutil reset or uninstall)"); changes += 1
}

let snap: [String: Any] = ["capturedAt": nowISO(), "state": current]
try? FileManager.default.createDirectory(atPath: sessions, withIntermediateDirectories: true)
try? JSONSerialization.data(withJSONObject: snap).write(to: URL(fileURLWithPath: snapshotPath))

let baseline = firstRun ? " (baseline established)" : ""
let deg = degraded.isEmpty ? "none" : degraded.joined(separator: ",")
print("[permission-ledger] tracked=\(current.count) changes=\(changes)\(baseline) degraded_scopes=\(deg)")
