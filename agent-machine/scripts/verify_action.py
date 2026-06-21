#!/usr/bin/env python3
"""
verify_action — the keystone gate every computer-control action passes through.

skill-synthesis-verified-action.md specifies it; this is the executable coarse version.
The on-device agent never executes a Step directly. It proposes a typed Step; this gate
DECIDES whether it may run, and the executor obeys the verdict. The whole safety story of
"an agent that controls my machine" reduces to: nothing happens that this function didn't
ALLOW, and everything that happens is in the ledger.

The discipline mirrors the compute moat (units.py): there the LLM proposes a law and physics
disposes; here the agent proposes an action and policy disposes. Same shape — propose / certify
/ act — applied to the world substrate instead of the held substrate.

Verdicts:
  ALLOW         — preconditions met, reversible (or has rollback), admissible. Execute + ledger.
  NEEDS_CONFIRM — legitimate but destructive/irreversible. Surface to the human first.
  BLOCK         — precondition unmet, or a prohibited-boundary action. Never auto-execute.

Run:  python3 scripts/verify_action.py     # self-test the policy on a battery of Steps
"""
import sys, os, json, time, re, hashlib

LEDGER = os.path.expanduser("~/.noetica/action-ledger.jsonl")

# The prohibited boundary — these never auto-execute regardless of how a Step is framed; they
# are deferred to the human (the same boundary the assistant itself honors). Matched on the
# action verb / target, conservatively (substring), because a missed match must fail SAFE.
# NB: no trailing \b — patterns ending in a non-word char (e.g. "rm -rf /") have no word
# boundary after them, so a closing \b would silently fail to match the most dangerous case.
PROHIBITED = {
    "credential_entry":   r"\b(passwd|password|secret|token|api[_-]?key|ssh-keygen|login)\b",
    "fund_transfer":      r"\b(transfer|wire|pay|trade|buy|sell|withdraw|deposit)\b",
    "access_control":     r"(chmod\s+777|chown|setfacl|usermod|visudo|sudoers|\bgrant\b|\brevoke\b)",
    "hard_delete":        r"(rm\s+-rf\s+/|mkfs|dd\s+if=|shred|wipe|format)",
    "security_settings":  r"(firewall|iptables\s+-F|csrutil|gatekeeper|defaults\s+write.*Security)",
}

# Destructive-but-legitimate ops: allowed only with rollback or explicit confirm.
DESTRUCTIVE = re.compile(r"\b(rm|rmdir|kill|pkill|killall|truncate|drop|delete|restart|reboot|"
                         r"unlink|mv|overwrite|reset|revert|prune|purge)\b", re.I)

# Pure observation — always admissible (the agent must be free to look before it leaps).
SENSE = re.compile(r"\b(cat|ls|stat|get|read|show|status|ps|top|df|du|grep|find|tail|head|"
                   r"inspect|list|describe|ping|curl\s+-s|sense|check)\b", re.I)


def _ledger(entry):
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    entry["ledger_ts"] = time.time()
    line = json.dumps(entry, sort_keys=True)
    entry["hash"] = hashlib.sha256(line.encode()).hexdigest()[:16]
    with open(LEDGER, "a") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry["hash"]


def _prohibited_hit(text):
    for name, pat in PROHIBITED.items():
        if re.search(pat, text, re.I):
            return name
    return None


def verify_action(step, world_state=None, ledger=True):
    """step = {action, substrate?, op?, precondition?, expected_effect?, reversible?, rollback_op?}
    world_state = {predicate: bool, ...} the agent SENSED before proposing.
    Returns {verdict, reasons[], hash?}. Deterministic; no model in the loop."""
    world_state = world_state or {}
    action = str(step.get("action", "")).strip()
    target = str(step.get("target", ""))
    text = f"{action} {target} {step.get('op','')}".strip()
    reasons = []

    # 1. observation is always admissible — see before you act
    is_sense = bool(SENSE.search(text)) and not DESTRUCTIVE.search(text)

    # 2. prohibited boundary — fail safe, defer to human (checked even for 'sense'-looking text)
    hit = _prohibited_hit(text)
    if hit:
        verdict = "BLOCK"
        reasons.append(f"prohibited-boundary:{hit} — deferred to human, never auto-executed")
        out = {"verdict": verdict, "reasons": reasons, "step": step}
        if ledger: out["hash"] = _ledger(dict(out))
        return out

    if is_sense:
        out = {"verdict": "ALLOW", "reasons": ["observation (read-only) — always admissible"], "step": step}
        if ledger: out["hash"] = _ledger(dict(out))
        return out

    # 3. precondition must hold in the sensed world (unknown precondition → cannot certify)
    pre = step.get("precondition")
    if pre:
        if pre not in world_state:
            reasons.append(f"precondition '{pre}' not sensed — cannot certify")
            out = {"verdict": "NEEDS_CONFIRM", "reasons": reasons, "step": step}
            if ledger: out["hash"] = _ledger(dict(out))
            return out
        if not world_state[pre]:
            reasons.append(f"precondition '{pre}' is FALSE in sensed world")
            out = {"verdict": "BLOCK", "reasons": reasons, "step": step}
            if ledger: out["hash"] = _ledger(dict(out))
            return out
        reasons.append(f"precondition '{pre}' holds")

    # 4. reversibility — destructive needs rollback or explicit confirm
    destructive = bool(DESTRUCTIVE.search(text))
    reversible = bool(step.get("reversible"))
    rollback = step.get("rollback_op")
    if destructive and not (reversible or rollback):
        reasons.append("destructive with no rollback_op and not marked reversible")
        out = {"verdict": "NEEDS_CONFIRM", "reasons": reasons, "step": step}
        if ledger: out["hash"] = _ledger(dict(out))
        return out
    if destructive:
        reasons.append(f"destructive but recoverable (rollback_op={rollback or 'reversible'})")

    # 5. admissible
    reasons.append("admissible — preconditions met, recoverable, within boundary")
    out = {"verdict": "ALLOW", "reasons": reasons, "step": step}
    if ledger: out["hash"] = _ledger(dict(out))
    return out


def main():
    battery = [
        ("look at a log",          {"action": "tail", "target": "/var/log/ocw-run.log"}, {}),
        ("restart wedged service", {"action": "restart", "target": "prometheusd", "precondition": "svc_down",
                                    "reversible": True, "rollback_op": "restart prometheusd"}, {"svc_down": True}),
        ("restart but svc is UP",  {"action": "restart", "target": "prometheusd", "precondition": "svc_down"},
                                   {"svc_down": False}),
        ("restart, precond unseen",{"action": "restart", "target": "prometheusd", "precondition": "svc_down"}, {}),
        ("rm a temp file (revert)",{"action": "rm", "target": "/tmp/scratch", "reversible": False,
                                    "rollback_op": "restore from /tmp/.trash"}, {}),
        ("rm with NO rollback",    {"action": "rm", "target": "/tmp/scratch"}, {}),
        ("rm -rf / (prohibited)",  {"action": "rm -rf /", "target": ""}, {}),
        ("chmod 777 (prohibited)", {"action": "chmod 777", "target": "/etc"}, {}),
        ("wire a payment (prohib)",{"action": "transfer", "target": "$500"}, {}),
        ("disable firewall (proh)",{"action": "iptables -F", "target": ""}, {}),
    ]
    print(f"# verify_action self-test — {len(battery)} Steps · ledger → {LEDGER}\n")
    icon = {"ALLOW": "✓", "NEEDS_CONFIRM": "?", "BLOCK": "✗"}
    for name, step, world in battery:
        r = verify_action(step, world, ledger=True)
        print(f"  {icon[r['verdict']]} {r['verdict']:14} {name:26} — {r['reasons'][-1]}")
    print(f"\n  ledger now holds {sum(1 for _ in open(LEDGER))} entries (append-only, hashed).")


if __name__ == "__main__":
    main()
