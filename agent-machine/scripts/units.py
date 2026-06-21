#!/usr/bin/env python3
"""
units — a tiny, inspectable dimensional-analysis engine (no pint, no heavy deps).

Every physical quantity is a vector of exponents over the 7 SI base dimensions
(mass, length, time, current, temp, amount, lum) plus a scale to SI base units. That's
all you need to (a) check a law is dimensionally homogeneous, (b) reject an extraction
whose units don't match the law, and (c) convert a "value unit" string to SI and back.

This is the deterministic gate the whole compute strategy leans on: the LLM proposes a
law + knowns, and physics — not the model — decides whether the proposal can possibly be
right. Units balance or it's rejected, full stop.
"""
BASE = ('mass', 'length', 'time', 'current', 'temp', 'amount', 'lum')


class DimError(Exception):
    pass


def dim(mass=0, length=0, time=0, current=0, temp=0, amount=0, lum=0):
    return (mass, length, time, current, temp, amount, lum)


DIMENSIONLESS = dim()


def _add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def _scale(a, n):
    return tuple(x * n for x in a)


def dim_str(d):
    if d == DIMENSIONLESS:
        return '1'
    num = '·'.join(f'{BASE[i]}{"^"+str(e) if e != 1 else ""}' for i, e in enumerate(d) if e > 0)
    den = '·'.join(f'{BASE[i]}{"^"+str(-e) if -e != 1 else ""}' for i, e in enumerate(d) if e < 0)
    return num + (f' / {den}' if den else '') or '1'


class Q:
    """A quantity carrying (scale-to-SI, dimension). Operators track both; +/- require
    matching dimensions — which is exactly what makes a law's homogeneity checkable."""
    __slots__ = ('scale', 'd')

    def __init__(self, scale=1.0, d=DIMENSIONLESS):
        self.scale = float(scale)
        self.d = d

    @staticmethod
    def _coerce(o):
        return o if isinstance(o, Q) else Q(o, DIMENSIONLESS)

    def __mul__(self, o):
        o = self._coerce(o); return Q(self.scale * o.scale, _add(self.d, o.d))
    __rmul__ = __mul__

    def __truediv__(self, o):
        o = self._coerce(o); return Q(self.scale / o.scale, _sub(self.d, o.d))

    def __rtruediv__(self, o):
        o = self._coerce(o); return Q(o.scale / self.scale, _sub(o.d, self.d))

    def __pow__(self, n):
        return Q(self.scale ** n, _scale(self.d, n))

    def __add__(self, o):
        o = self._coerce(o)
        if self.d != o.d:
            raise DimError(f'cannot add {dim_str(self.d)} + {dim_str(o.d)}')
        return Q(self.scale, self.d)
    __radd__ = __add__

    def __sub__(self, o):
        o = self._coerce(o)
        if self.d != o.d:
            raise DimError(f'cannot subtract {dim_str(self.d)} - {dim_str(o.d)}')
        return Q(self.scale, self.d)

    def __rsub__(self, o):
        return Q._coerce(o).__sub__(self)

    def __neg__(self):
        return Q(-self.scale, self.d)


# Unit symbol -> Q(scale_to_SI_base, dimension). Compound units ("m/s**2", "N*m") are
# parsed by eval-ing the string in this namespace, so the operator algebra above does it.
_L = dim(length=1); _M = dim(mass=1); _T = dim(time=1); _I = dim(current=1)
_K = dim(temp=1); _MOL = dim(amount=1)
UNITS = {
    # length
    'm': Q(1, _L), 'cm': Q(1e-2, _L), 'mm': Q(1e-3, _L), 'km': Q(1e3, _L), 'nm': Q(1e-9, _L),
    # mass
    'kg': Q(1, _M), 'g': Q(1e-3, _M),
    # time
    's': Q(1, _T), 'ms': Q(1e-3, _T), 'min': Q(60, _T), 'h': Q(3600, _T),
    # base others
    'A': Q(1, _I), 'K': Q(1, _K), 'mol': Q(1, _MOL),
    # derived (defined via base dims so checks compose)
    'N': Q(1, dim(mass=1, length=1, time=-2)),          # force
    'J': Q(1, dim(mass=1, length=2, time=-2)),          # energy
    'eV': Q(1.602176634e-19, dim(mass=1, length=2, time=-2)),
    'W': Q(1, dim(mass=1, length=2, time=-3)),          # power
    'C': Q(1, dim(time=1, current=1)),                  # charge
    'V': Q(1, dim(mass=1, length=2, time=-3, current=-1)),   # volt
    'ohm': Q(1, dim(mass=1, length=2, time=-3, current=-2)),
    'Pa': Q(1, dim(mass=1, length=-1, time=-2)),        # pressure
    'atm': Q(101325, dim(mass=1, length=-1, time=-2)),
    'Hz': Q(1, dim(time=-1)),
    'L': Q(1e-3, dim(length=3)),                        # liter
}


UNITS['Ω'] = UNITS['ohm']
UNITS['F'] = Q(1, dim(mass=-1, length=-2, time=4, current=2))  # farad (capacitance)
# SI prefixes — resolved on a unit token only when the whole token isn't a unit itself
# (so 'm' stays metres, 'min'/'mol'/'kg' are untouched, but 'kN','mN','MeV','kPa' scale).
PREFIXES = {'G': 1e9, 'M': 1e6, 'k': 1e3, 'd': 1e-1, 'c': 1e-2, 'm': 1e-3,
            'u': 1e-6, 'µ': 1e-6, 'n': 1e-9, 'p': 1e-12}


def _resolve(tok):
    if tok in UNITS:
        return UNITS[tok]
    for p, scale in PREFIXES.items():
        if tok.startswith(p) and tok[len(p):] in UNITS:
            base = UNITS[tok[len(p):]]
            return Q(scale * base.scale, base.d)
    raise DimError(f'unknown unit: {tok}')


def parse_unit(u):
    """'m/s**2', 'N*m', 'kN', 'MeV' -> Q (prefix-aware). (^ accepted for **, · for *.)
    Any malformed/unknown unit raises DimError (a clean rejection, never a crash)."""
    import re
    u = (u or '').strip().replace('^', '**').replace('·', '*').replace('⋅', '*')
    if u in ('', '1', 'dimensionless'):
        return Q(1, DIMENSIONLESS)
    ns = {'__builtins__': {}}
    try:
        for t in set(re.findall(r'[A-Za-zµΩ]\w*', u)):
            ns[t] = _resolve(t)
        return eval(u, ns)  # namespace closed to resolved unit tokens only
    except DimError:
        raise
    except Exception:
        raise DimError(f'unparseable unit: {u!r}')


def to_si(value, unit):
    """(value, unit_str) -> (value_in_SI_base, dimension)."""
    q = parse_unit(unit)
    return value * q.scale, q.d


def dimension_of(expr, var_dims):
    """Dimension of a sympy-style expression string given each variable's dimension.
    Evaluates the expression with vars bound to Q(1, dim) — raises DimError on a
    non-homogeneous sum, returns the result dimension otherwise."""
    ns = {name: Q(1, d) for name, d in var_dims.items()}
    ns['__builtins__'] = {}
    res = eval(expr.replace('^', '**'), ns)
    return Q._coerce(res).d


if __name__ == '__main__':
    # self-test: conversions + a homogeneity check + a deliberate failure
    print('# units self-test')
    print('  9.8 m/s^2  ->', to_si(9.8, 'm/s**2'))
    print('  2 km       ->', to_si(2, 'km'), '(SI metres)')
    print('  1 eV       ->', to_si(1, 'eV'), '(SI joules)')
    vd = {'x': _L, 'x0': _L, 'v0': dim(length=1, time=-1), 't': _T, 'a': dim(length=1, time=-2)}
    print('  dim(x0 + v0*t + a*t**2/2) =', dim_str(dimension_of('x0 + v0*t + a*t**2/2', vd)), '(expect length)')
    try:
        dimension_of('x0 + v0', vd)   # length + velocity -> must fail
    except DimError as e:
        print('  rejected bad sum:', e)
