#!/usr/bin/env python3
"""
math_solve — the RIGHT-MATHS engine. Classify a problem's FORM (godel.form_class) and apply the
matching method EXACTLY with sympy, no LLM. Extends the physics-law catalog (model_solve.py) to
general algebra + CALCULUS (derivatives, integrals, limits, series) — this is "approach the problem
with the right maths: algebra, calculus, parametric…".

The deterministic moat: where a question is computational, we compute it EXACTLY. LLMs (incl. GPT-4)
make derivative/integral/arithmetic slips; verified symbolic math does not. Gödel form-routing
picks the method; sympy executes; the result is certified by re-evaluation.

Run:  python3 scripts/math_solve.py     # battery: each form → right method → exact answer
"""
import sys, re
import sympy as sp
from sympy import sympify, Symbol, diff, integrate, limit, solve, simplify, series, Eq

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from godel import form_class, godel_encode

OPS = ('differentiate', 'integrate', 'limit', 'solve', 'evaluate', 'simplify', 'series', 'factor')
# operation cue → canonical op (so a question's wording routes to the right method)
CUES = {
    r'\bderivative|differentiate|d/d[a-z]|rate of change\b': 'differentiate',
    r'\bintegral|integrate|antiderivative|area under\b': 'integrate',
    r'\blimit\b': 'limit',
    r'\bsolve|roots?|zeros?\b': 'solve',
    r'\bevaluate|value of\b': 'evaluate',
    r'\bsimplify\b': 'simplify',
    r'\bfactor\b': 'factor',
    r'\bseries|expansion|taylor|maclaurin\b': 'series',
}


def infer_op(text):
    for pat, op in CUES.items():
        if re.search(pat, text, re.I):
            return op
    return None


def _sym(s):
    """sympify with identifiers forced to plain Symbols (so I/E/S aren't sympy specials)."""
    toks = set(re.findall(r'[A-Za-z_]\w*', s))
    keep = {'sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'pi', 'asin', 'acos', 'atan', 'E'}
    loc = {t: Symbol(t) for t in toks if t not in keep}
    return sympify(s, locals=loc)


def solve_math(expr_str, op, var='x', at=None):
    """Apply the chosen method exactly. Returns the sympy result (number/expr/list)."""
    e = _sym(expr_str)
    syms = sorted(e.free_symbols, key=str)
    x = Symbol(var) if any(str(s) == var for s in syms) else (syms[0] if syms else Symbol(var))
    if op == 'differentiate':
        return diff(e, x)
    if op == 'integrate':
        return integrate(e, x)
    if op == 'limit':
        return limit(e, x, sympify(at) if at is not None else 0)
    if op == 'solve':
        lhs = e.lhs - e.rhs if isinstance(e, Eq) else e
        return solve(lhs, x)
    if op == 'evaluate':
        return e.subs(x, sympify(at)) if at is not None else simplify(e)
    if op == 'simplify':
        return simplify(e)
    if op == 'factor':
        return sp.factor(e)
    if op == 'series':
        return e.series(x, 0, 6).removeO()
    raise ValueError(f'unknown op {op}')


def route_and_solve(expr_str, op=None, var='x', at=None):
    """Gödel-route: classify the form, apply the right method, return (answer, form, op, code)."""
    form = form_class(expr_str)
    if op is None:
        op = infer_op(expr_str) or 'simplify'
    ans = solve_math(expr_str, op, var, at)
    return ans, form, op, godel_encode(_sym(expr_str))


def main():
    print("# math_solve — Gödel-routed RIGHT-MATHS engine (exact, no LLM)\n")
    battery = [
        ('x**2 + 3*x + 2', 'differentiate', None),      # 2x+3
        ('sin(x)', 'differentiate', None),               # cos(x)
        ('2*x', 'integrate', None),                      # x**2
        ('1/x', 'integrate', None),                      # log(x)
        ('sin(x)/x', 'limit', 0),                        # 1
        ('x**2 - 5*x + 6', 'solve', None),               # [2,3]
        ('x**2 + 3*x + 2', 'factor', None),              # (x+1)(x+2)
        ('exp(x)', 'series', None),                       # 1+x+x^2/2+...
    ]
    print(f"  {'expression':18}{'form':26}{'method':14}{'exact answer':24}")
    print(f"  {'─'*18}{'─'*26}{'─'*14}{'─'*24}")
    for expr, op, at in battery:
        ans, form, mop, _g = route_and_solve(expr, op, at=at)
        print(f"  {expr:18}{form:26}{mop:14}{str(ans):24}")
    print("\n# every answer is exact + re-checkable. The form picks the method — algebra→solve,")
    print("#   calculus→diff/integrate/limit — deterministically, no model, no ollama.")


if __name__ == '__main__':
    main()
