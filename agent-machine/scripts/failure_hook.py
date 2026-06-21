#!/usr/bin/env python3
"""
failure_hook — make the incident memory fill from REAL use, not synthetic seeds.

incident_capture.py defines the FailureAtom + capture(); this is the plumbing that FEEDS it
from three real sources:
  1. a wrapped command that exits non-zero  → source="shell"
  2. a non-ALLOW verdict from the gate        → source="gate-NEG"  (the agent learning from
                                                 its own blocked/failed actions)
  3. error lines scraped from an existing log → source="log"
Point any of these at the store and the brain begins accumulating the failures it will later
cluster, correlate, and fix — which is the whole point of "capture all failures, errors, issues."

Usage:
  python3 scripts/failure_hook.py -- <command...>     # run it; capture a FailureAtom if it fails
  python3 scripts/failure_hook.py --ingest-log FILE    # scrape error lines out of an existing log
  python3 scripts/failure_hook.py --selftest           # demo: a failing command + a gate BLOCK

Wire it into your shell (optional) so every failed command is remembered:
  noe() { python3 ~/dev/Noetica/agent-machine/scripts/failure_hook.py -- "$@"; }
"""
import sys, os, subprocess, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import incident_capture as ic
from verify_action import verify_action

# exit code -> severity (124=timeout, 137=OOM / kill -9, 139=segv, 143=SIGTERM)
FATAL = {124, 134, 137, 139, 143}
ERROR_LINE = re.compile(r"\b(error|failed|fatal|exception|traceback|refused|timed?\s*out|"
                        r"cannot|no such|denied|panic|killed|segmentation|unable)\b", re.I)
# progress/noise lines that contain "error" only as substring (gsutil spam, course slugs, etc.)
SKIP_LINE = re.compile(r"Copying gs://|files\]\[|Done\s+[\d.]+\s+[MK]iB/s|Operation completed|"
                       r"error-correcting|^[/\\|-]\s+\[|ETA\s+\d")


def run(cmd, capture_on_fail=True):
    """Run a command; on non-zero exit, record a FailureAtom into the real incident store.
    Returns (exit, stdout, stderr) so a caller can keep going."""
    proc = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True)
    if proc.returncode != 0 and capture_on_fail:
        cmd_s = cmd if isinstance(cmd, str) else " ".join(cmd)
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        excerpt = " ".join(tail[-4:])[:400]
        sev = "fatal" if proc.returncode in FATAL else "error"
        ic.capture(f"$ {cmd_s} -> exit code {proc.returncode}: {excerpt}",
                   source="shell", severity=sev,
                   context={"cmd": cmd_s, "exit": proc.returncode})
    return proc.returncode, proc.stdout, proc.stderr


def record_gate_neg(step, world_state=None):
    """Run a Step through the gate; if it's not ALLOWed, that block is itself a failure to
    remember. Returns the gate verdict so the caller still gets the decision."""
    v = verify_action(step, world_state, ledger=False)
    if v["verdict"] != "ALLOW":
        ic.capture(f"gate {v['verdict']} on '{step.get('action')}': {v['reasons'][-1]}",
                   source="gate-NEG", severity="warn",
                   context={"step": step, "verdict": v["verdict"]})
    return v


def ingest_log(path, max_hits=500):
    """Scrape error lines out of an existing log into FailureAtoms — skipping progress noise."""
    n = 0
    with open(path, errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or len(line) > 600 or SKIP_LINE.search(line):
                continue
            if ERROR_LINE.search(line):
                ic.capture(line[:400], source="log", severity="error")
                n += 1
                if n >= max_hits:
                    break
    return n


def _selftest():
    ic.STORE = os.path.expanduser("~/.noetica/incidents-demo.jsonl")
    if os.path.exists(ic.STORE):
        os.remove(ic.STORE)
    print("# failure_hook self-test — real command failure + gate BLOCK -> incident store\n")

    rc, _, _ = run("ls /nonexistent-xyz-12345")
    print(f"  1. ran a failing command (exit {rc}) -> captured")
    rc, _, _ = run(["python3", "-c", "import sys; sys.exit(137)"])
    print(f"  2. ran a process 'killed' (exit {rc}) -> captured fatal")
    v = record_gate_neg({"action": "rm -rf /", "target": ""})
    print(f"  3. proposed a prohibited action -> gate {v['verdict']} -> captured as gate-NEG")

    atoms = ic._load()
    print(f"\n  incident store now holds {len(atoms)} real FailureAtoms:")
    for a in atoms:
        print(f"   [{a['severity']:5}] {a['source']:8} {a['symptom'][:64]}  sym={a['symbols']}")
    incs = ic.cluster_incidents()
    print(f"\n  -> {len(incs)} incident(s); each ready to be correlated, tagged, and fixed.")


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--selftest":
        return _selftest()
    if args[0] == "--ingest-log":
        if len(args) < 2:
            sys.exit("usage: --ingest-log FILE")
        n = ingest_log(args[1])
        print(f"# ingested {n} error line(s) from {args[1]} -> {ic.STORE}")
        return
    cmd = args[1:] if args[0] == "--" else args
    rc, out, err = run(cmd)
    sys.stdout.write(out)
    sys.stderr.write(err)
    sys.exit(rc)


if __name__ == "__main__":
    main()
