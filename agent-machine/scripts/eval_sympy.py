#!/usr/bin/env python3
"""
eval_sympy — the deterministic half of autoformalization. The LLM writes Python/sympy expressions
that should evaluate to a problem's numeric answer; this executes them in a LOCKED-DOWN namespace
(no builtins, sympy math only) with a hard timeout, and prints the numeric result. Pairing an LLM
formalizer with this exact executor is the field's recipe (autoformalize → solve → verify).

stdin:  one JSON per line  {"id": <int>, "expr": "<python/sympy expression>"}
stdout: one JSON per line  {"id": <int>, "val": <float|null>}
"""
import sys, json, signal
import sympy as sp

# a small, safe surface — sympy callables only, NO builtins (so eval can't reach the system)
_NS = {
    'sqrt': sp.sqrt, 'pi': sp.pi, 'E': sp.E, 'exp': sp.exp, 'log': sp.log, 'ln': sp.log,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'factorial': sp.factorial, 'binomial': sp.binomial, 'Rational': sp.Rational, 'Abs': sp.Abs,
    'gcd': sp.gcd, 'lcm': sp.lcm, 'floor': sp.floor, 'ceiling': sp.ceiling, 'Integer': sp.Integer,
    'Float': sp.Float, 'oo': sp.oo, 'Sum': sp.Sum, 'summation': sp.summation, 'prod': sp.prod,
    'Symbol': sp.Symbol, 'symbols': sp.symbols, 'solve': sp.solve, 'simplify': sp.simplify,
    'diff': sp.diff, 'integrate': sp.integrate, 'limit': sp.limit, 'Matrix': sp.Matrix,
    'I': sp.I, 'root': sp.root, 'Min': sp.Min, 'Max': sp.Max, 'sign': sp.sign,
}


class _TO(Exception):
    pass


def _alarm(signum, frame):
    raise _TO()


def evaluate(expr):
    signal.signal(signal.SIGALRM, _alarm)
    signal.setitimer(signal.ITIMER_REAL, 4.0)
    try:
        val = eval(expr, {'__builtins__': {}}, _NS)   # locked namespace; no builtins reachable
        if isinstance(val, (list, tuple)):
            val = val[0] if len(val) == 1 else None
        num = sp.N(val)
        f = float(num)
        if f != f or abs(f) == float('inf'):           # NaN / inf → reject
            return None
        return round(f, 6)
    except Exception:
        return None
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
            v = evaluate(str(o['expr']))
        except Exception:
            o, v = {'id': None}, None
        print(json.dumps({'id': o.get('id'), 'val': v}), flush=True)


if __name__ == '__main__':
    main()
