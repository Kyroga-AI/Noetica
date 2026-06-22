#!/usr/bin/env python3
"""
godel — canonical Gödel numbering of SYMBOLIC structure. The deterministic 'form' code (tzurah).

Embeddings give fuzzy semantic similarity; Gödel numbering gives EXACT structural identity — the
complementary, opposite tool. A formula's structure (its canonical AST) is serialized to a symbol
sequence and encoded as a unique integer g = ∏ pᵢ^(code of i-th node). Python bignums make this
exact and tractable for the short sequences math/logic forms are. Consequences:

  • Two expressions share a Gödel code IFF they are structurally identical (after sympy's canonical
    ordering) — so law-matching becomes exact arithmetic, not fuzzy LLM extraction.
  • Encoding STRUCTURAL ROLES (Add/Mul/Pow/Symbol/Derivative…) rather than variable names gives a
    FORM code: F=m·a and P=I·V share a form (Mul of two symbols); x²+3x+2 is 'polynomial deg 2';
    sin(x) is 'transcendental'; d/dx is 'differential'. That is "classify the maths by form".

This is the symbolic layer's exact substrate — deterministic, no ollama. It sharpens the
computational fraction of a problem set; it is NOT a similarity metric and does not answer fuzzy
conceptual questions (that needs reasoning, not encoding).

Run:  python3 scripts/godel.py        # self-test: form classes + structural identity
"""
import sys
import sympy as sp
from sympy import sympify, Symbol, Integer, Rational, Float, Add, Mul, Pow, Function, Derivative, Integral, Eq

# Structural-role alphabet → small codes. Names are NOT encoded (so structurally-identical forms
# collide by design); a separate channel can carry variable identity when you want the exact law.
ROLE = {Add: 2, Mul: 3, Pow: 4, Eq: 5, Symbol: 6, Integer: 7, Rational: 8, Float: 9,
        Derivative: 10, Integral: 11}
_TRIG = {'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh'}


def _primes(n):
    ps, c = [], 2
    while len(ps) < n:
        if all(c % p for p in ps):
            ps.append(c)
        c += 1
    return ps


def _roles(expr):
    """Canonical pre-order sequence of structural-role codes (sympy canonicalizes Add/Mul order)."""
    seq = []
    def walk(e):
        if isinstance(e, Symbol):       seq.append(ROLE[Symbol]); return
        if isinstance(e, Integer):      seq.append(ROLE[Integer]); return
        if isinstance(e, Rational):     seq.append(ROLE[Rational]); return
        if isinstance(e, Float):        seq.append(ROLE[Float]); return
        if isinstance(e, Derivative):   seq.append(ROLE[Derivative])
        elif isinstance(e, Integral):   seq.append(ROLE[Integral])
        elif isinstance(e, Eq):         seq.append(ROLE[Eq])
        elif isinstance(e, Add):        seq.append(ROLE[Add])
        elif isinstance(e, Mul):        seq.append(ROLE[Mul])
        elif isinstance(e, Pow):        seq.append(ROLE[Pow])
        elif isinstance(e, Function):   seq.append(12 + (sum(map(ord, e.func.__name__)) % 50))  # function family
        else:                           seq.append(99)
        for a in e.args:
            walk(a)
    walk(expr)
    return seq


def godel_encode(expr):
    """Canonical Gödel number of an expression's structure: g = ∏ pᵢ^(roleᵢ). Exact identity."""
    if isinstance(expr, str):
        expr = sympify(expr.replace('=', '-(') + ')') if '=' in expr else sympify(expr)
    seq = _roles(expr)
    ps = _primes(len(seq))
    g = 1
    for p, code in zip(ps, seq):
        g *= p ** code
    return g


def form_class(expr):
    """The math FORM, read off the structure — deterministic routing for the compute arm."""
    if isinstance(expr, str):
        expr = sympify(expr.replace('=', '-(') + ')') if '=' in expr else sympify(expr)
    if expr.atoms(Derivative):
        return 'differential (calculus)'
    if expr.atoms(Integral):
        return 'integral (calculus)'
    funcs = {f.func.__name__ for f in expr.atoms(Function)}
    if funcs & _TRIG:
        return 'trigonometric (transcendental)'
    if any(f in funcs for f in ('exp', 'log')):
        return 'exp/log (transcendental)'
    syms = list(expr.free_symbols)
    if syms:
        # symbolic exponent => exponential; else polynomial (checked FIRST — a polynomial is also a
        # rational function) / rational / algebraic by structure
        if any(isinstance(p, Pow) and p.exp.free_symbols for p in expr.atoms(Pow)):
            return 'exponential'
        try:
            if expr.is_polynomial(*syms):
                deg = sp.Poly(sp.expand(expr), *syms).total_degree()
                return f'polynomial (deg {deg})'
        except Exception:
            pass
        try:
            if expr.is_rational_function(*syms):
                return 'rational'
        except Exception:
            pass
    return 'algebraic'


def main():
    print("# godel — canonical FORM codes + math-form classification (deterministic, no LLM)\n")
    forms = ['m*a', 'a*m', 'F*d', 'x**2 + 3*x + 2', '1/(1+x)', 'sin(x) + cos(x)',
             'exp(-x)', 'Derivative(f(x), x)', 'Integral(x**2, x)', 'v0*t + a*t**2/2']
    print(f"  {'expression':24}{'form':28}{'gödel code (struct)':>22}")
    print(f"  {'─'*24}{'─'*28}{'─'*22}")
    codes = {}
    for f in forms:
        try:
            g = godel_encode(f); fc = form_class(f)
        except Exception as e:
            g, fc = None, f'err: {e}'
        codes[f] = g
        gs = (str(g)[:14] + '…') if g and len(str(g)) > 15 else str(g)
        print(f"  {f:24}{fc:28}{gs:>22}")
    print("\n  structural identity (same FORM ⇒ same code):")
    print(f"    m*a  ≡  a*m   : {codes['m*a'] == codes['a*m']}   (commutativity canonicalized)")
    print(f"    m*a  ≡  F*d   : {codes['m*a'] == codes['F*d']}   (F=ma and W=Fd are the SAME form)")
    print(f"    m*a  ≡  x²+3x+2: {codes['m*a'] == codes['x**2 + 3*x + 2']}  (different structure)")
    print("\n  → form_class routes the compute arm: polynomial→solve, differential→diff,")
    print("    transcendental→numeric; the gödel code matches a question's form to a catalog law exactly.")


if __name__ == '__main__':
    main()
