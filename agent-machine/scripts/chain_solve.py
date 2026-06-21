#!/usr/bin/env python3
"""
chain_solve — multi-hop verified derivation over the governing-law catalog.

The single-hop COMPUTE arm recognizes ONE law and computes. This lifts that ceiling:
state = the set of known quantities; an action = any catalog law all of whose inputs are
already known (and dimension-matched); applying it DERIVES a new quantity. Forward-chain
until the target is known. It's a planner over the law graph — and because every hop is
dimension-checked against the law's typed variables, the whole derivation is verified, not
just the last step.

Quantities are keyed by variable name AND dimension, so a 'v' (velocity) derived by one law
can only feed a law that wants a velocity — pressure-P can never be mistaken for power-P.

Run:  python3 scripts/chain_solve.py
"""
from model_solve import MODELS, solve_model
from model_verify import DIMS, CONSTS
from units import to_si, dim_str


def law_step(law, known):
    """If exactly one variable of `law` is unknown given `known` (+ its constants),
    return (target_var, {input_var: si_value}); else (None, None)."""
    vd = DIMS.get(law)
    if not vd:
        return None, None
    consts = CONSTS.get(law, {})
    unsat, inputs = [], {}
    for v, d in vd.items():
        if v in consts:
            inputs[v] = consts[v]
        elif v in known and known[v][1] == d:   # known AND dimension matches this slot
            inputs[v] = known[v][0]
        else:
            unsat.append(v)
    if len(unsat) == 1:
        return unsat[0], inputs
    return None, None


def chain_solve(knowns_units, target, max_steps=8):
    """knowns_units = {name: (value, unit)}. Forward-chain in BFS rounds (so the first time
    the target is derived is via a shortest path), then backtrack provenance to report ONLY
    the hops that actually fed the target — not the greedy side-derivations."""
    known, prov = {}, {}
    for name, (val, unit) in knowns_units.items():
        si, d = to_si(val, unit)
        known[name] = (si, d)
    for _ in range(max_steps):
        if target in known:
            break
        progressed = False
        for law in MODELS:
            tgt, inputs = law_step(law, known)
            if tgt is None or tgt in known:
                continue
            try:
                val = solve_model(MODELS[law][0], inputs, tgt)
            except Exception:
                continue
            if not isinstance(val, float):
                continue
            known[tgt] = (val, DIMS[law][tgt])
            prov[tgt] = (law, [v for v in DIMS[law] if v != tgt and v not in CONSTS.get(law, {})])
            progressed = True
            if tgt == target:
                break
        if target in known or not progressed:
            break
    # backtrack: keep only the sub-DAG that produced the target, in dependency order
    chain, seen = [], set()

    def walk(q):
        if q in seen or q not in prov:
            return
        seen.add(q)
        law, inps = prov[q]
        for i in inps:
            walk(i)
        chain.append((law, q, known[q][0], DIMS[law][q]))

    if target in known:
        walk(target)
    return (known[target][0] if target in known else None), chain, known


def show(name, knowns, target):
    val, path, known = chain_solve(knowns, target)
    given = ', '.join(f'{k}={v[0]}{v[1]}' for k, v in knowns.items())
    print(f'## {name}')
    print(f'   given: {given}   →  find {target}')
    for i, (law, tgt, v, d) in enumerate(path, 1):
        rel = '★' if tgt == target else ' '
        print(f'   {rel} hop {i}: [{law}]  ⇒  {tgt} = {v:.6g}  [{dim_str(d)}]')
    if val is not None:
        print(f'   ✓ {target} = {val:.6g}   ({len(path)} hop{"s" if len(path)!=1 else ""}, every hop dimension-verified)\n')
    else:
        print(f'   · could not reach {target} from the catalog\n')
    return val


if __name__ == '__main__':
    # 2-hop: rest + accel for a time, then kinetic energy  (kinematics → KE)
    show('Object accelerates, then its kinetic energy',
         {'m': (2, 'kg'), 'v0': (0, 'm/s'), 'a': (3, 'm/s**2'), 't': (4, 's')}, 'KE')
    # 2-hop: work done over a distance, then the power  (work → power)
    show('Work over a distance in a time, then power',
         {'F': (10, 'N'), 'd': (5, 'm'), 't': (2, 's')}, 'P')
    # 2-hop: momentum first, sanity that single-hop still works inside the chainer
    show('Momentum of a moving mass',
         {'m': (3, 'kg'), 'v': (4, 'm/s')}, 'p')
    # 3-hop: accelerate from rest → velocity → momentum  (kinematics → momentum)
    show('Accelerate from rest, then momentum',
         {'m': (5, 'kg'), 'v0': (0, 'm/s'), 'a': (2, 'm/s**2'), 't': (3, 's')}, 'p')
