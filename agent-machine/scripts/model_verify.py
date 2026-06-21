#!/usr/bin/env python3
"""
model_verify — the moat: physics verifies the LLM's extraction before we ever compute.

model_solve.py instantiates a law and solves it; this layer adds dimensions. Each model
declares the dimension of every variable, so we can:
  1. self-check that every catalogued law is dimensionally HOMOGENEOUS (LHS dim == RHS dim),
  2. REJECT an extraction whose units don't match the law (the LLM said a is "m/s"? that's a
     velocity, not an acceleration — rejected, no wrong answer computed),
  3. solve in SI and report the result WITH its dimension.

The point: a 3B proposes (law, knowns+units); units — not the model — decide whether the
proposal can be right. That converts "trust the LLM's arithmetic" into "the LLM only
parses; the law computes; physics certifies."

Run:  python3 scripts/model_verify.py
"""
import sys
from units import dim, dim_str, dimension_of, to_si, DimError
from model_solve import MODELS, solve_model

# per-model variable dimensions (SI base-dim exponents)
FORCE = dim(mass=1, length=1, time=-2)
ENERGY = dim(mass=1, length=2, time=-2)
DIMS = {
    "Newton's 2nd law":      {'F': FORCE, 'm': dim(mass=1), 'a': dim(length=1, time=-2)},
    "Kinematics (position)": {'x': dim(length=1), 'x0': dim(length=1), 'v0': dim(length=1, time=-1),
                              't': dim(time=1), 'a': dim(length=1, time=-2)},
    "Kinematics (velocity)": {'v': dim(length=1, time=-1), 'v0': dim(length=1, time=-1),
                              'a': dim(length=1, time=-2), 't': dim(time=1)},
    "Kinetic energy":        {'KE': ENERGY, 'm': dim(mass=1), 'v': dim(length=1, time=-1)},
    "Universal gravitation": {'F': FORCE, 'G': dim(mass=-1, length=3, time=-2),
                              'm1': dim(mass=1), 'm2': dim(mass=1), 'r': dim(length=1)},
    "Hooke's law":           {'F': FORCE, 'k': dim(mass=1, time=-2), 'x': dim(length=1)},
    "Ohm's law":             {'V': dim(mass=1, length=2, time=-3, current=-1), 'I': dim(current=1),
                              'R': dim(mass=1, length=2, time=-3, current=-2)},
    "Power (electrical)":    {'P': dim(mass=1, length=2, time=-3),
                              'V': dim(mass=1, length=2, time=-3, current=-1), 'I': dim(current=1)},
    "Coulomb's law":         {'F': FORCE, 'k': dim(mass=1, length=3, time=-4, current=-2),
                              'q1': dim(time=1, current=1), 'q2': dim(time=1, current=1), 'r': dim(length=1)},
    "Ideal gas law":         {'P': dim(mass=1, length=-1, time=-2), 'V': dim(length=3), 'n': dim(amount=1),
                              'R': dim(mass=1, length=2, time=-2, amount=-1, temp=-1), 'T': dim(temp=1)},
    "Gibbs free energy":     {'G': ENERGY, 'H': ENERGY, 'T': dim(temp=1),
                              'S': dim(mass=1, length=2, time=-2, temp=-1)},
    "Density":               {'rho': dim(mass=1, length=-3), 'm': dim(mass=1), 'V': dim(length=3)},
    "Lens / mirror eq":      {'f': dim(length=1), 'do': dim(length=1), 'di': dim(length=1)},
    "Wave speed":            {'v': dim(length=1, time=-1), 'f': dim(time=-1), 'lam': dim(length=1)},
    "Capacitor charge":      {'Q': dim(time=1, current=1), 'C': dim(mass=-1, length=-2, time=4, current=2),
                              'V': dim(mass=1, length=2, time=-3, current=-1)},
    "Capacitor energy":      {'E': ENERGY, 'C': dim(mass=-1, length=-2, time=4, current=2),
                              'V': dim(mass=1, length=2, time=-3, current=-1)},
    "Momentum":              {'p': dim(mass=1, length=1, time=-1), 'm': dim(mass=1), 'v': dim(length=1, time=-1)},
    "Work (force·distance)": {'W': ENERGY, 'F': FORCE, 'd': dim(length=1)},
    "Power (work/time)":     {'P': dim(mass=1, length=2, time=-3), 'W': ENERGY, 't': dim(time=1)},
    "Electrical power (I²R)":{'P': dim(mass=1, length=2, time=-3), 'I': dim(current=1),
                              'R': dim(mass=1, length=2, time=-3, current=-2)},
    "Gravitational PE":      {'U': ENERGY, 'm': dim(mass=1), 'g': dim(length=1, time=-2), 'h': dim(length=1)},
    "Centripetal force":     {'F': FORCE, 'm': dim(mass=1), 'v': dim(length=1, time=-1), 'r': dim(length=1)},
    "Centripetal acceleration": {'a': dim(length=1, time=-2), 'v': dim(length=1, time=-1), 'r': dim(length=1)},
    "Specific heat":         {'Qh': ENERGY, 'm': dim(mass=1), 'c': dim(length=2, time=-2, temp=-1), 'dT': dim(temp=1)},
    "Period–frequency":      {'Tp': dim(time=1), 'f': dim(time=-1)},
    "Kinematics (no time)":  {'vf': dim(length=1, time=-1), 'v0': dim(length=1, time=-1),
                              'a': dim(length=1, time=-2), 'd': dim(length=1)},
    "Photon energy":         {'E': ENERGY, 'h': dim(mass=1, length=2, time=-1), 'f': dim(time=-1)},
}

# Physical constants are never in the problem text — inject them by law (note 'k' means the
# Coulomb constant here, NOT Hooke's spring constant, which is a per-problem variable).
CONSTS = {
    "Universal gravitation": {'G': 6.674e-11},
    "Coulomb's law": {'k': 8.9875e9},
    "Ideal gas law": {'R': 8.314},
    "Gravitational PE": {'g': 9.80665},
    "Photon energy": {'h': 6.62607015e-34},
}


def selfcheck():
    """Every catalogued law must be dimensionally homogeneous."""
    npass = 0
    print('# 1. catalog homogeneity (LHS dim == RHS dim)')
    for name, (eq, _dom, disp, _t) in MODELS.items():
        vd = DIMS.get(name)
        if not vd:
            print(f'  ?  {disp:24} (no dims declared)'); continue
        lhs, rhs = eq.split('=', 1)
        try:
            dl, dr = dimension_of(lhs, vd), dimension_of(rhs, vd)
            ok = dl == dr
            npass += ok
            print(f'  {"✓" if ok else "✗"}  {disp:24} {dim_str(dl)}{"" if ok else "  ≠  " + dim_str(dr)}')
        except DimError as e:
            print(f'  ✗  {disp:24} {e}')
    print(f'  → {npass}/{len(MODELS)} laws homogeneous\n')


def verify_and_solve(name, knowns, target=None):
    """knowns = {var: (value, unit_str)}. Verify each unit against the law, then solve in SI.
    Raises DimError (the rejection) if any unit is dimensionally wrong for its slot."""
    eq, vd = MODELS[name][0], DIMS[name]
    si = {}
    for var, (val, unit) in knowns.items():
        if var not in vd:
            continue  # ignore stray vars the model invented; the matching ones still gate
        v_si, d = to_si(val, unit)
        if d != vd[var]:
            raise DimError(f'unit mismatch: {var}={val} {unit} is [{dim_str(d)}], '
                           f'but {name} needs {var} in [{dim_str(vd[var])}]')
        si[var] = v_si
    si.update(CONSTS.get(name, {}))  # inject physical constants (G, k, R)
    # robust target: ignore a bogus target, then require exactly one remaining unknown
    unknowns = [n for n in vd if n not in si]
    if target not in vd:
        target = None
    if target is None:
        if len(unknowns) != 1:
            raise DimError(f'underdetermined: {len(unknowns)} unknowns {unknowns}')
        target = unknowns[0]
    return solve_model(eq, si, target), target, dim_str(vd[target])


def main():
    selfcheck()

    print('# 2. verified solve (good extraction) — convert units, certify, compute')
    demos = [
        ("Newton's 2nd law", {'m': (1000, 'kg'), 'a': (2, 'm/s**2')}),
        ("Ideal gas law",    {'V': (22.4, 'L'), 'n': (1, 'mol'), 'R': (8.314, 'J/mol/K'), 'T': (273, 'K')}),
        ("Kinematics (position)", {'x0': (0, 'm'), 'v0': (0, 'm/s'), 'a': (9.8, 'm/s**2'), 't': (3, 's')}),
        ("Kinetic energy",   {'m': (2, 'kg'), 'v': (3, 'm/s')}),
    ]
    for name, knowns in demos:
        try:
            res, tgt, td = verify_and_solve(name, knowns)
            r = f'{res:.4g}' if isinstance(res, float) else res
            print(f'  ✓ {name:24} ⇒ {tgt} = {r}  [{td}]')
        except DimError as e:
            print(f'  ✗ {name:24} {e}')

    print('\n# 3. REJECTION (the moat) — bad extraction caught BEFORE a wrong answer is computed')
    bad = [
        ("Newton's 2nd law", {'m': (1000, 'kg'), 'a': (2, 'm/s')},   "a given as a velocity"),
        ("Ideal gas law",    {'V': (22.4, 'L'), 'n': (1, 'mol'), 'R': (8.314, 'J/mol/K'), 'T': (273, 'Pa')}, "T given as a pressure"),
        ("Kinetic energy",   {'m': (2, 'J'), 'v': (3, 'm/s')},       "m given as an energy"),
    ]
    for name, knowns, why in bad:
        try:
            res, tgt, td = verify_and_solve(name, knowns)
            print(f'  ⚠ {name:24} computed {tgt}={res} — SHOULD have rejected ({why})')
        except DimError as e:
            print(f'  ✓ rejected: {why:24} → {e}')


if __name__ == '__main__':
    main()
