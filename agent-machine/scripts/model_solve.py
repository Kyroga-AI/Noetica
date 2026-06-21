#!/usr/bin/env python3
"""
model_solve — INSTANTIATE the governing models and actually compute with them.

core_models.py only stores equation *strings* for display; nothing ever bound a
variable or solved for an unknown. This is the missing half: each governing law is a
real symbolic relation, and given the known quantities we solve for the target and
return the number. Deterministic, exact, no LLM, no retrieval — the law does the work.

It's deliberately basic: parse "F = m*a" into an equation, substitute what's known,
solve for what's not. The whole point of the core-models thesis is that this is ALL a
STEM answer needs once you've identified the governing form.

Run:  python3 scripts/model_solve.py            # instantiate every model + self-test
      python3 scripts/model_solve.py --json
"""
import sys, json, re
import sympy as sp


def _symtab(eq_str):
    """Force every identifier to a plain Symbol — sympy otherwise reads I as the imaginary
    unit, E as Euler's number, S as the SingletonRegistry, etc., which breaks physics vars."""
    return {n: sp.Symbol(n) for n in set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", eq_str))}

# name -> (ascii sympy equation, domain, display, self-test {knowns} -> (target, expected))
MODELS = {
    "Newton's 2nd law":        ("F = m*a",                 "classical_mechanics", "F = m·a",
                                 ({"m": 1000, "a": 2}, "F", 2000)),
    "Kinematics (position)":   ("x = x0 + v0*t + a*t**2/2","classical_mechanics", "x = x0 + v0·t + ½a·t²",
                                 ({"x0": 0, "v0": 0, "a": 9.8, "t": 3}, "x", 44.1)),
    "Kinematics (velocity)":   ("v = v0 + a*t",            "classical_mechanics", "v = v0 + a·t",
                                 ({"v0": 5, "a": 2, "t": 4}, "v", 13)),
    "Kinetic energy":          ("KE = m*v**2/2",           "classical_mechanics", "KE = ½m·v²",
                                 ({"m": 2, "v": 3}, "KE", 9)),
    "Universal gravitation":   ("F = G*m1*m2/r**2",        "classical_mechanics", "F = G·m1·m2/r²",
                                 ({"G": 6.674e-11, "m1": 5.97e24, "m2": 7.35e22, "r": 3.84e8}, "F", None)),
    "Hooke's law":             ("F = k*x",                 "classical_mechanics", "F = k·x",
                                 ({"k": 200, "x": 0.05}, "F", 10)),
    "Ohm's law":               ("V = I*R",                 "circuits_signals",    "V = I·R",
                                 ({"I": 2, "R": 5}, "V", 10)),
    "Power (electrical)":      ("P = V*I",                 "circuits_signals",    "P = V·I",
                                 ({"V": 12, "I": 0.5}, "P", 6)),
    "Coulomb's law":           ("F = k*q1*q2/r**2",        "electromagnetism",    "F = k·q1·q2/r²",
                                 ({"k": 8.99e9, "q1": 1e-6, "q2": 2e-6, "r": 0.1}, "F", None)),
    "Ideal gas law":           ("P*V = n*R*T",             "thermodynamics",      "P·V = n·R·T",
                                 ({"V": 0.0224, "n": 1, "R": 8.314, "T": 273}, "P", None)),
    "Gibbs free energy":       ("G = H - T*S",             "thermodynamics",      "G = H − T·S",
                                 ({"H": 100, "T": 300, "S": 0.2}, "G", 40)),
    "Density":                 ("rho = m/V",               "chemistry",           "ρ = m/V",
                                 ({"m": 50, "V": 10}, "rho", 5)),
    "Lens / mirror eq":        ("1/f = 1/do + 1/di",       "optics",              "1/f = 1/do + 1/di",
                                 ({"f": 10, "do": 30}, "di", 15)),
    "Wave speed":              ("v = f*lam",               "circuits_signals",    "v = f·λ",
                                 ({"f": 440, "lam": 0.78}, "v", 343.2)),
    "Capacitor charge":        ("Q = C*V",                 "electromagnetism",    "Q = C·V",
                                 ({"C": 0.002, "V": 5}, "Q", 0.01)),
    "Capacitor energy":        ("E = C*V**2/2",            "electromagnetism",    "E = ½C·V²",
                                 ({"C": 1e-5, "V": 100}, "E", 0.05)),
    "Momentum":                ("p = m*v",                 "classical_mechanics", "p = m·v",
                                 ({"m": 2, "v": 3}, "p", 6)),
    "Work (force·distance)":   ("W = F*d",                 "classical_mechanics", "W = F·d",
                                 ({"F": 10, "d": 5}, "W", 50)),
    "Power (work/time)":       ("P = W/t",                 "classical_mechanics", "P = W/t",
                                 ({"W": 100, "t": 20}, "P", 5)),
    "Electrical power (I²R)":  ("P = I**2*R",              "circuits_signals",    "P = I²·R",
                                 ({"I": 2, "R": 5}, "P", 20)),
    "Gravitational PE":        ("U = m*g*h",               "classical_mechanics", "U = m·g·h",
                                 ({"m": 2, "h": 10}, "U", None)),
    "Centripetal force":       ("F = m*v**2/r",            "classical_mechanics", "F = m·v²/r",
                                 ({"m": 2, "v": 3, "r": 1}, "F", 18)),
    "Centripetal acceleration":("a = v**2/r",              "classical_mechanics", "a = v²/r",
                                 ({"v": 4, "r": 2}, "a", 8)),
    "Specific heat":           ("Qh = m*c*dT",             "thermodynamics",      "Q = m·c·ΔT",
                                 ({"m": 2, "c": 4184, "dT": 10}, "Qh", 83680)),
    "Period–frequency":        ("Tp = 1/f",                "circuits_signals",    "T = 1/f",
                                 ({"f": 2}, "Tp", 0.5)),
    "Kinematics (no time)":    ("vf**2 = v0**2 + 2*a*d",   "classical_mechanics", "vf² = v0² + 2a·d",
                                 ({"v0": 0, "a": 2, "d": 4}, "vf", None)),
    "Photon energy":           ("E = h*f",                 "electromagnetism",    "E = h·f",
                                 ({"f": 5e14}, "E", None)),
}


def solve_model(eq_str, knowns, target=None):
    """Bind the knowns into the law and solve for the remaining unknown. Pure sympy."""
    lhs, rhs = eq_str.split("=", 1)
    loc = _symtab(eq_str)
    eq = sp.Eq(sp.sympify(lhs, locals=loc), sp.sympify(rhs, locals=loc))
    syms = {s.name: s for s in eq.free_symbols}
    unknown_names = [n for n in syms if n not in knowns]
    if target is None:
        if len(unknown_names) != 1:
            raise ValueError(f"need exactly one unknown; got {unknown_names}")
        target = unknown_names[0]
    subbed = eq.subs({syms[k]: v for k, v in knowns.items() if k in syms})
    sols = sp.solve(subbed, syms[target])
    out = []
    for s in sols:
        s = sp.nsimplify(s) if not s.free_symbols else s
        out.append(float(s) if getattr(s, "is_number", False) else str(s))
    return out[0] if len(out) == 1 else out


def main():
    as_json = "--json" in sys.argv
    rows, npass = [], 0
    for name, (eq, domain, disp, test) in MODELS.items():
        knowns, target, expected = test
        try:
            got = solve_model(eq, knowns, target)
            ok = expected is None or (isinstance(got, float) and abs(got - expected) < 1e-3)
            npass += ok
            rows.append({"model": name, "domain": domain, "eq": disp,
                         "solved_for": target, "given": knowns, "result": got,
                         "expected": expected, "pass": ok})
        except Exception as e:
            rows.append({"model": name, "domain": domain, "eq": disp, "error": str(e), "pass": False})
    if as_json:
        print(json.dumps(rows, indent=2)); return
    print(f"# INSTANTIATE governing models — bind knowns, solve for the unknown ({npass}/{len(MODELS)} self-tests pass)\n")
    for r in rows:
        if "error" in r:
            print(f"  ✗ {r['model']:24} ERROR: {r['error']}"); continue
        g = ", ".join(f"{k}={v}" for k, v in r["given"].items())
        res = f"{r['result']:.4g}" if isinstance(r["result"], float) else r["result"]
        chk = "" if r["expected"] is None else (" ✓" if r["pass"] else f" ✗ (want {r['expected']})")
        print(f"  {r['eq']:24}  given [{g}]  ⇒  {r['solved_for']} = {res}{chk}")


if __name__ == "__main__":
    main()
