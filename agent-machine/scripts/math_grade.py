#!/usr/bin/env python3
"""
math_grade — answer-equivalence for free-response math (the grader half of a
frontier-math board, the MATH/AIME analog of the MCQ letter-match in
mmlu-brain-bench.ts). Frontier math answers are expressions (fractions, radicals,
matrices), not letters, so grading is sympy equivalence — the standard MATH
benchmark method (Hendrycks et al. `math_equivalence`), done here in the same
locked-down sympy namespace as eval_sympy.py (no builtins reachable).

stdin:  one JSON per line  {"id": <int>, "gold": "<latex/plain>", "cand": "<latex/plain>"}
stdout: one JSON per line  {"id": <int>, "match": <bool>, "how": "<sympy|numeric|string|null>"}

A candidate matches the gold if ANY holds (in order):
  sympy   — simplify(gold - cand) == 0            (exact symbolic equality)
  numeric — |N(gold) - N(cand)| < 1e-6            (numeric equality fallback)
  string  — normalized strings are identical      (last resort for non-parseable)
Non-parseable / timed-out comparisons fall through to string match, else False.
"""
import sys
import json
import re
import signal
import sympy as sp

# same safe surface as eval_sympy.py — sympy callables only, NO builtins
_NS = {
    'sqrt': sp.sqrt, 'pi': sp.pi, 'E': sp.E, 'exp': sp.exp, 'log': sp.log, 'ln': sp.log,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'factorial': sp.factorial, 'binomial': sp.binomial, 'Rational': sp.Rational, 'Abs': sp.Abs,
    'gcd': sp.gcd, 'lcm': sp.lcm, 'floor': sp.floor, 'ceiling': sp.ceiling, 'Integer': sp.Integer,
    'Float': sp.Float, 'oo': sp.oo, 'I': sp.I, 'root': sp.root, 'Min': sp.Min, 'Max': sp.Max,
    'sign': sp.sign, 'pi_': sp.pi,
}


class _TO(Exception):
    pass


def _alarm(signum, frame):
    raise _TO()


def _strip_latex(s: str) -> str:
    """Turn a \\boxed{}-style LaTeX answer into a sympy-parseable expression string.
    Deliberately conservative: handles the common MATH answer forms, leaves the rest
    for the string-match fallback rather than guessing."""
    s = s.strip()
    # peel one or more \boxed{...} / \boxed ...
    m = re.search(r'\\boxed\s*{(.+)}', s, re.S)
    if m:
        s = m.group(1)
    # drop display wrappers and spacing macros
    s = s.replace('\\left', '').replace('\\right', '')
    s = s.replace('\\!', '').replace('\\,', '').replace('\\;', '').replace('\\ ', ' ')
    s = s.replace('$', '').replace('\\$', '')
    s = s.replace('\\dfrac', '\\frac').replace('\\tfrac', '\\frac').replace('\\cdot', '*').replace('\\times', '*')
    s = s.replace('\\pi', 'pi').replace('\\infty', 'oo')
    s = s.replace('%', '').strip()
    # \frac{a}{b} -> ((a)/(b))   (repeat for nesting)
    frac = re.compile(r'\\frac\s*{([^{}]+)}\s*{([^{}]+)}')
    for _ in range(6):
        new = frac.sub(r'((\1)/(\2))', s)
        if new == s:
            break
        s = new
    # \sqrt{x} -> sqrt(x) ; \sqrt[n]{x} -> root(x,n)
    s = re.sub(r'\\sqrt\s*\[([^\]]+)\]\s*{([^{}]+)}', r'root(\2,\1)', s)
    s = re.sub(r'\\sqrt\s*{([^{}]+)}', r'sqrt(\1)', s)
    # exponent ^ -> ** ; strip remaining braces and backslashes
    s = s.replace('^', '**').replace('{', '(').replace('}', ')')
    s = s.replace('\\', '')
    # thousands separators inside numbers
    s = re.sub(r'(?<=\d),(?=\d{3}\b)', '', s)
    return s.strip()


def _sympify(s: str):
    return sp.sympify(_strip_latex(s), locals=_NS)


def grade(gold: str, cand: str):
    if cand is None:
        return False, 'null'
    gn, cn = _strip_latex(gold), _strip_latex(cand)
    signal.signal(signal.SIGALRM, _alarm)
    signal.setitimer(signal.ITIMER_REAL, 4.0)
    try:
        g = sp.sympify(gn, locals=_NS)
        c = sp.sympify(cn, locals=_NS)
        try:
            if sp.simplify(g - c) == 0:
                return True, 'sympy'
        except Exception:
            pass
        try:
            if abs(float(sp.N(g)) - float(sp.N(c))) < 1e-6:
                return True, 'numeric'
        except Exception:
            pass
    except (_TO, Exception):
        pass
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    # string fallback — normalized, whitespace-free
    if re.sub(r'\s+', '', gn) == re.sub(r'\s+', '', cn):
        return True, 'string'
    return False, 'null'


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        ok, how = grade(str(rec.get('gold', '')), rec.get('cand'))
        print(json.dumps({'id': rec.get('id'), 'match': ok, 'how': how}))


if __name__ == '__main__':
    main()
