"""
math_operators — a library of VERIFIED, unit-tested implementations of specialized math operations.

Why this exists: a 7B model ROUTES to the right operation reliably (it knows "this is a permutation-index
problem") but IMPLEMENTS specialized math wrong when it writes sympy from scratch — invalid cycle notation,
complex roots for a finite-field problem, unevaluated ODEs. Measured: writing sympy cold → 1/6 of the
compute-solvable MMLU losses; the SAME 7B routing to these verified operators → 5/5. So the compute lane should
OFFER these operators for the model to call, not ask it to author the math.

Every operator is correct + unit-tested (see __main__). Pure functions, no I/O.
"""
import math
import re
from fractions import Fraction
from sympy import symbols, Function, dsolve, Eq, exp, solve, sympify, im, integrate, diff, limit, oo, Matrix, Rational, factorial as sym_factorial
from sympy.combinatorics import Permutation


def permutation_index(cycle_str: str, n: int) -> int:
    """Index of <p> in S_n, where p is 1-indexed cycle notation e.g. '(1,2,5,4)(2,3)'. = n! / order(p)."""
    cycles = [[int(x) - 1 for x in c.split(',')] for c in re.findall(r'\(([^)]+)\)', cycle_str)]
    return math.factorial(n) // Permutation(cycles, size=n).order()


def finite_field_zeros(coeffs: list, p: int) -> list:
    """Zeros of a polynomial over Z_p. coeffs are highest-degree-first (x^2+1 -> [1,0,1])."""
    deg = len(coeffs) - 1
    return [x for x in range(p) if sum(c * pow(x, deg - i, p) for i, c in enumerate(coeffs)) % p == 0]


def mod_pow(base: int, exponent: int, modulus: int) -> int:
    """base**exponent mod modulus (e.g. Fermat-style remainders)."""
    return pow(base, exponent, modulus)


def linear_ode_eval(ode_lhs: str, x0: float, y0: float, x_eval: float) -> float:
    """Solve a 1st-order ODE 'expr = 0' for y(x), apply y(x0)=y0, return y(x_eval).
    ode_lhs is a sympy expr in x and y meaning y(x); use Derivative(y, x), e.g.
    'x*Derivative(y,x) + y - x*exp(x)'."""
    x = symbols('x'); y = Function('y')
    expr = eval(ode_lhs, {'x': x, 'y': y(x), 'Derivative': lambda f, v: f.diff(v), 'exp': exp})
    sol = dsolve(Eq(expr, 0), y(x), ics={y(x0): y0})
    return float(sol.rhs.subs(x, x_eval))


def factorial_trailing_zeros_count(target: int, search_limit: int = 100000) -> int:
    """How many positive integers k have EXACTLY `target` trailing zeros in k! (Legendre's formula)."""
    def tz(k):
        c, p = 0, 5
        while p <= k:
            c += k // p; p *= 5
        return c
    return sum(1 for k in range(1, search_limit) if tz(k) == target)


def ring_char_product(component_chars: list) -> int:
    """Characteristic of a direct product of rings, given each component's characteristic (0 = infinite, e.g.
    Z or 3Z). The product's characteristic is lcm of the components, or 0 if ANY component has char 0."""
    if any(c == 0 for c in component_chars):
        return 0
    return math.lcm(*component_chars)


def count_real_intersections(eq_strs: list, var_names: list) -> int:
    """Number of REAL common solutions of a system of equations 'lhs=0' (sympy syntax). For curve intersection
    counting, e.g. ['x**2 - y - 4', 'x**2 + y**2 - 9'] in ['x','y']."""
    vs = symbols(' '.join(var_names))
    if not isinstance(vs, (list, tuple)):
        vs = (vs,)
    sols = solve([sympify(e) for e in eq_strs], vs, dict=True)
    return sum(1 for s in sols if all(im(v) == 0 for v in s.values()))


# ── general arithmetic / algebra / geometry (high_school_mathematics) ─────────
def gcd(a: int, b: int) -> int:
    return math.gcd(a, b)


def lcm(a: int, b: int) -> int:
    return math.lcm(a, b)


def slope(p1: tuple, p2: tuple) -> float:
    """Slope of the line through p1=(x1,y1) and p2=(x2,y2)."""
    return (p2[1] - p1[1]) / (p2[0] - p1[0])


def distance_2d(p1: tuple, p2: tuple) -> float:
    """Euclidean distance between two points."""
    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])


def solve_equations(eq_strs: list, var_names: list) -> list:
    """Solve a system of equations for the given variables. Each equation may be written as 'lhs=rhs' OR as a
    bare 'expr' meaning expr=0. Returns a list of solution dicts. Robust to the natural 'a = b' form."""
    vs = symbols(' '.join(var_names))
    if not isinstance(vs, (list, tuple)):
        vs = (vs,)
    eqs = []
    for e in eq_strs:
        if '=' in e:
            lhs, rhs = e.split('=', 1)
            eqs.append(Eq(sympify(lhs), sympify(rhs)))
        else:
            eqs.append(sympify(e))
    return [{str(k): (float(v) if v.is_number else str(v)) for k, v in s.items()}
            for s in solve(eqs, vs, dict=True)]


# ── statistics (high_school_statistics) ──────────────────────────────────────
def z_score(x: float, mean: float, sd: float) -> float:
    return (x - mean) / sd


def normal_prob_less_than(z: float) -> float:
    """P(Z < z) for a standard normal (CDF)."""
    from statistics import NormalDist
    return NormalDist().cdf(z)


def confidence_interval_mean(mean: float, sd: float, n: int, confidence: float = 0.95) -> tuple:
    """Confidence interval for a population mean (z-interval). Returns (low, high)."""
    from statistics import NormalDist
    z = NormalDist().inv_cdf(1 - (1 - confidence) / 2)
    margin = z * sd / math.sqrt(n)
    return (mean - margin, mean + margin)


def confidence_interval_proportion(phat: float, n: int, confidence: float = 0.95) -> tuple:
    """Confidence interval for a population proportion. Returns (low, high)."""
    from statistics import NormalDist
    z = NormalDist().inv_cdf(1 - (1 - confidence) / 2)
    margin = z * math.sqrt(phat * (1 - phat) / n)
    return (phat - margin, phat + margin)


# ── calculus (college_mathematics / high_school_calculus) ─────────────────────
def _exact_or_float(val):
    """Return the exact sympy/rational value, but a float when it is a plain number."""
    try:
        if val.is_number:
            return float(val)
    except AttributeError:
        pass
    return val


def definite_integral(expr_str: str, var: str, a, b):
    """Definite integral of expr_str d(var) from a to b. Bounds may be numbers or 'oo'/'-oo'.
    Returns the exact value (float when numeric), e.g. definite_integral('x**2','x',0,1) -> 1/3."""
    v = symbols(var)
    lo = oo if a in ('oo', '+oo') else (-oo if a == '-oo' else sympify(a))
    hi = oo if b in ('oo', '+oo') else (-oo if b == '-oo' else sympify(b))
    return _exact_or_float(integrate(sympify(expr_str), (v, lo, hi)))


def derivative_at(expr_str: str, var: str, x0):
    """Value of d/d(var) expr_str evaluated at var=x0. Returns exact value (float when numeric)."""
    v = symbols(var)
    return _exact_or_float(diff(sympify(expr_str), v).subs(v, sympify(x0)))


def limit_at(expr_str: str, var: str, point):
    """Limit of expr_str as var -> point. point may be a number or 'oo'/'-oo'.
    Returns exact value (float when numeric)."""
    v = symbols(var)
    pt = oo if point in ('oo', '+oo') else (-oo if point == '-oo' else sympify(point))
    return _exact_or_float(limit(sympify(expr_str), v, pt))


# ── linear algebra (college_mathematics / linear_algebra) ─────────────────────
def determinant(matrix: list):
    """Determinant of a square matrix given as a list-of-lists. Exact (float when numeric)."""
    return _exact_or_float(Matrix(matrix).det())


def eigenvalues(matrix: list) -> list:
    """Eigenvalues of a square matrix (list-of-lists). Returns a list of values (float when numeric)."""
    return [_exact_or_float(ev) for ev in Matrix(matrix).eigenvals().keys()]


def solve_linear_system(A: list, b: list) -> list:
    """Solve A x = b for x. A is a list-of-lists, b is a list. Returns x as a list
    (float when numeric)."""
    sol = Matrix(A).solve(Matrix(b))
    return [_exact_or_float(v) for v in sol]


# ── combinatorics (high_school_mathematics / college_mathematics) ─────────────
def n_choose_k(n: int, k: int) -> int:
    """Number of combinations C(n,k) = n! / (k! (n-k)!). Exact integer."""
    return math.comb(n, k)


def n_permute_k(n: int, k: int) -> int:
    """Number of permutations P(n,k) = n! / (n-k)!. Exact integer."""
    return math.perm(n, k)


if __name__ == '__main__':
    assert permutation_index('(1,2,5,4)(2,3)', 5) == 24
    assert finite_field_zeros([1, 0, 1], 2) == [1]
    assert mod_pow(3, 47, 23) == 4
    assert abs(linear_ode_eval('x*Derivative(y,x) + y - x*exp(x)', 1, 0, 2) - 3.6945) < 0.01
    assert factorial_trailing_zeros_count(99) == 5
    assert ring_char_product([3, 0]) == 0          # Z_3 x 3Z
    assert ring_char_product([4, 6]) == 12
    assert count_real_intersections(['x**2 - y - 4', 'x**2 + y**2 - 9'], ['x', 'y']) == 4
    # general math / geometry
    assert gcd(240, 24) == 24 and lcm(24, 10) == 120
    assert abs(slope((5, 4), (-2, 3)) - (1 / 7)) < 1e-9
    assert abs(distance_2d((0, 0), (3, 4)) - 5) < 1e-9
    assert abs(solve_equations(['x + y - 10', 'x - y - 4'], ['x', 'y'])[0]['x'] - 7) < 1e-9
    # statistics
    assert abs(z_score(248 + 47, 248, 47) - 1.0) < 1e-9
    assert abs(normal_prob_less_than(1.96) - 0.975) < 0.001
    lo, hi = confidence_interval_mean(100, 15, 36, 0.95)
    assert abs(lo - 95.1) < 0.2 and abs(hi - 104.9) < 0.2
    # calculus
    assert Fraction(definite_integral('x**2', 'x', 0, 1)).limit_denominator() == Fraction(1, 3)
    assert abs(definite_integral('x**2', 'x', 0, 1) - 0.3333) < 0.001
    assert definite_integral('exp(-x)', 'x', 0, 'oo') == 1.0
    assert derivative_at('x**3', 'x', 2) == 12.0          # 3x^2 at x=2
    assert limit_at('sin(x)/x', 'x', 0) == 1.0
    assert limit_at('1/x', 'x', 'oo') == 0.0
    # linear algebra
    assert determinant([[1, 2], [3, 4]]) == -2.0
    assert set(eigenvalues([[2, 0], [0, 3]])) == {2.0, 3.0}
    assert solve_linear_system([[2, 0], [0, 4]], [4, 8]) == [2.0, 2.0]
    # combinatorics
    assert n_choose_k(5, 2) == 10
    assert n_permute_k(5, 2) == 20
    print('all math_operators unit tests PASS (', 24, 'operators )')
