#!/usr/bin/env python3
"""
verified_execute — the seam EVERY computer-control action passes through.

The actual executor (Claude computer-use / the on-device agent) lives outside this repo. Rather
than wire a specific one, this is the chokepoint it plugs into: it composes the gate
(verify_action) + the failure memory (incident_capture) + the ledger into ONE call —

    guarded_execute(step, sense, execute, confirm=None)

The executor injects two callables: SENSE (read world_state) and EXECUTE (perform the step).
This function does the rest, in order:
  1. SENSE the world  →  2. GATE it  →  3. run ONLY if ALLOW (or a confirmed NEEDS_CONFIRM)
  →  4. SENSE again to check the postcondition  →  5. capture a FailureAtom on any NEG/raise.
Nothing runs that the gate didn't allow; every failure (incl. the agent's own) is remembered.
This is "describe → propose → verify → execute-with-guards," as one function.

Wiring (the executor's side, one line):
    from verified_execute import guarded_execute
    result = guarded_execute(step, sense=my_sense, execute=my_exec, confirm=ask_human)

Run:  python3 scripts/verified_execute.py     # self-test the seam with fakes (ALLOW/NEG/BLOCK/CONFIRM)
"""
import sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_action import verify_action
import incident_capture as ic


def guarded_execute(step, sense, execute, confirm=None):
    """step = a typed Step (see skill-synthesis-verified-action.md).
    sense(step)   -> dict of sensed predicates (the world the gate reasons over).
    execute(step) -> performs it; return value is opaque, surfaced back to the caller.
    confirm(step, verdict) -> truthy to proceed past a NEEDS_CONFIRM (human-in-the-loop).
    Returns {ran, verdict, ok?, result?, postcondition?, ...}."""
    world = sense(step) or {}
    v = verify_action(step, world)  # gate ledgers the verdict (hashed, append-only)

    if v["verdict"] == "BLOCK":
        ic.capture(f"gate BLOCK on '{step.get('action')}': {v['reasons'][-1]}",
                   source="gate-NEG", severity="warn", context={"step": step})
        return {"ran": False, "verdict": "BLOCK", "reasons": v["reasons"]}

    if v["verdict"] == "NEEDS_CONFIRM":
        if not (confirm and confirm(step, v)):
            return {"ran": False, "verdict": "NEEDS_CONFIRM", "reasons": v["reasons"]}
        # human approved — fall through and run it

    try:
        result = execute(step)
    except Exception as e:  # an action that raised is a failure to remember
        ic.capture(f"execute raised on '{step.get('action')}': {e}",
                   source="shell", severity="error", context={"step": step})
        return {"ran": True, "verdict": v["verdict"], "ok": False, "error": str(e)}

    # postcondition: SENSE again and check the step's expected_effect actually holds
    post = sense(step) or {}
    effect = step.get("expected_effect")
    ok = True
    if effect is not None:
        ok = bool(post.get(effect))
        if not ok:
            ic.capture(f"postcondition '{effect}' FALSE after '{step.get('action')}' (NEG)",
                       source="gate-NEG", severity="error", context={"step": step})
    return {"ran": True, "verdict": v["verdict"], "ok": ok,
            "result": result, "postcondition": effect, "post_state": post}


def _selftest():
    ic.STORE = os.path.expanduser("~/.noetica/incidents-exec-demo.jsonl")
    if os.path.exists(ic.STORE):
        os.remove(ic.STORE)
    print("# verified_execute self-test — gate + execute + postcondition + capture, with fakes\n")

    # A shared fake world the injected sense/execute read & mutate.
    world = {"svc_down": True, "svc_up": False}
    def sense(_step): return dict(world)
    def exec_fix(_step): world["svc_up"] = True; world["svc_down"] = False; return "restarted prometheusd"
    def exec_noop(_step): return "ran but nothing changed"

    restart = {"action": "restart", "target": "prometheusd", "precondition": "svc_down",
               "expected_effect": "svc_up", "reversible": True, "rollback_op": "restart prometheusd"}

    # 1. ALLOW → run → postcondition holds (POS)
    r = guarded_execute(restart, sense, exec_fix)
    print(f"  1. ALLOW→run→POS     ran={r['ran']} verdict={r['verdict']} ok={r['ok']} ({r['result']})")

    # 2. ALLOW → run → postcondition FALSE (NEG, captured) — reset world, use the no-op executor
    world.update(svc_down=True, svc_up=False)
    r = guarded_execute(restart, sense, exec_noop)
    print(f"  2. ALLOW→run→NEG     ran={r['ran']} ok={r['ok']} → FailureAtom captured")

    # 3. BLOCK → refused + captured
    r = guarded_execute({"action": "rm -rf /", "target": ""}, sense, exec_fix)
    print(f"  3. BLOCK→refuse      ran={r['ran']} verdict={r['verdict']} → gate-NEG captured")

    # 4. NEEDS_CONFIRM → halts without confirm; proceeds with confirm
    risky = {"action": "rm", "target": "/tmp/scratch"}
    r = guarded_execute(risky, sense, exec_noop)
    print(f"  4a. NEEDS_CONFIRM    ran={r['ran']} verdict={r['verdict']} (no confirm → halted)")
    r = guarded_execute(risky, sense, exec_noop, confirm=lambda s, v: True)
    print(f"  4b. …confirmed       ran={r['ran']} (human approved → executed)")

    caps = sum(1 for _ in open(ic.STORE)) if os.path.exists(ic.STORE) else 0
    print(f"\n  {caps} FailureAtoms captured from this run (the NEG + the BLOCK) — the brain learned.")


if __name__ == "__main__":
    _selftest()
