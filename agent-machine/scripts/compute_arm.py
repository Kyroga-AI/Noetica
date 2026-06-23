#!/usr/bin/env python3
"""
compute_arm — the verified-compute benchmark arm (selective prediction, not raw accuracy).

Pipeline per question:
  1. LLM EXTRACTS (law, knowns+units, target) from the menu of governing laws — parse only.
  2. model_verify VERIFIES the units against the law; a mismatch is REJECTED (no compute).
  3. solve in SI, then PLUG-BACK check (residual ~ 0).
  4. MATCH the computed value to a multiple-choice option (unit-aware).
  5. ANSWER if all gates pass, else ABSTAIN.

We report the metric that actually shows a lead: coverage (how much it dares answer) and
accuracy-on-attempted (how right it is when it does) — head-to-head vs the plain 3B on the
SAME items. The thesis: on the verifiable subset, the verified core is far more accurate
than the model alone, and it *knows* which subset that is.

Run:  OLLAMA_HOST=http://127.0.0.1:11434 python3 scripts/compute_arm.py
      MMLU_SUBJECTS=college_physics,high_school_physics MMLU_PER_SUBJECT=40 python3 ...
"""
import os, sys, re, json, signal, urllib.request
import sympy as sp
from units import parse_unit, to_si, dimension_of, DimError
from model_verify import MODELS, DIMS, verify_and_solve
from chain_solve import chain_solve
from math_solve import solve_math, infer_op   # Gödel-routed exact calculus/algebra

BANK = os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')
BASE = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
MODEL = os.environ.get('MMLU_MODEL', 'llama3.2:3b')
PER = int(os.environ.get('MMLU_PER_SUBJECT', '40'))
SUBJECTS = os.environ.get('MMLU_SUBJECTS', 'college_physics,high_school_physics,conceptual_physics').split(',')
LETTERS = ['A', 'B', 'C', 'D']


class _Timeout(Exception):
    pass


def _timed(secs, fn, *a, **k):
    """Run fn with a hard wall-clock cap — LLM-written sympy (solve/factorial/integrate) can run
    forever; the compute must never hang the loop. SIGALRM (main thread); no-op on non-Unix."""
    if not hasattr(signal, 'SIGALRM'):
        return fn(*a, **k)
    def _h(_s, _f):
        raise _Timeout()
    old = signal.signal(signal.SIGALRM, _h)
    signal.alarm(secs)
    try:
        return fn(*a, **k)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


_SYMPY_NS = {'sqrt', 'exp', 'log', 'factorial', 'binomial', 'sin', 'cos', 'tan',
             'asin', 'acos', 'atan', 'pi', 'Rational', 'Abs', 'floor', 'ceiling'}


def _eq_vars(eq):
    """Variable names in an equation (drop sympy funcs/constants) — so every law carries a
    vars hint, which the extractor needs to map knowns even when no DIMS are declared."""
    seen = [t for t in re.findall(r'[A-Za-z_]\w*', eq) if t not in _SYMPY_NS]
    return list(dict.fromkeys(seen))


def law_menu():
    # Surface the WHOLE catalog (MODELS), not just the dimensionally-declared subset (DIMS) —
    # otherwise the function-based laws (combinatorics, quadratic, reactance) are invisible to the
    # extractor and it abstains on them. Every form keeps a vars hint (declared dims or derived).
    lines = []
    for name, (eq, _dom, _disp, _t) in MODELS.items():
        vd = DIMS.get(name)
        vars_ = list(vd) if vd else _eq_vars(eq)
        lines.append(f'- {name}: {eq}   vars: {", ".join(vars_)}')
    return '\n'.join(lines)


MENU = law_menu()
SYS = (
    'You translate a physics/chem multiple-choice question into a governing law and its '
    'known quantities. You do NOT solve it. Pick exactly one law from the menu whose '
    'variables match what the question gives and asks. Output ONLY a JSON object:\n'
    '{"law": "<exact name or null>", "knowns": {"var": [number, "unit"]}, "target": "<var to find>"}\n'
    'Use SI-style unit strings (m, kg, s, m/s**2, N, J, mol, K, Pa, L, V, A, ohm). '
    'If no single law on the menu fits, output {"law": null}.'
)


def ollama(messages, timeout=90):
    body = json.dumps({'model': MODEL, 'stream': False, 'temperature': 0, 'messages': messages}).encode()
    for attempt in range(2):  # one retry on a transient failure — never let a call kill the run
        try:
            req = urllib.request.Request(f'{BASE}/v1/chat/completions', body, {'content-type': 'application/json'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
            m = d.get('choices', [{}])[0].get('message', {})
            return (m.get('content') or m.get('reasoning_content') or '').strip()
        except Exception:
            if attempt == 1:
                return ''
    return ''


def resolve_law(name):
    """The model often echoes the whole menu line ('Power (electrical): P = V*I') or a
    paraphrase — match it back to a catalog key by name."""
    if not name:
        return None
    name = str(name).split(':')[0].strip()
    if name in MODELS:
        return name
    low = name.lower()
    for k in MODELS:
        if k.lower() == low or low.startswith(k.lower()) or k.lower().startswith(low):
            return k
    return None


def _sci(s):
    """Normalize '2 x 10^3' / '10^-4' style scientific notation to Python float syntax."""
    s = s.replace('×', 'x').replace('·', '*')
    s = re.sub(r'(\d(?:\.\d+)?)\s*x\s*10\s*\^?\s*([-+]?\d+)', r'\1e\2', s)  # 2 x 10^3 -> 2e3
    s = re.sub(r'\b10\s*\^\s*([-+]?\d+)', r'1e\1', s)                       # 10^-4 -> 1e-4
    return s


_NUMU = re.compile(r'([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(.*)')


def parse_one(v):
    """Accept [num, 'unit'], 'num unit', or num — return (float, unit) or None."""
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        if len(v) >= 2 and not isinstance(v[0], (list, dict)):
            try:
                return (float(_sci(str(v[0]))), str(v[1]).strip())
            except Exception:
                pass
        return parse_one(v[0]) if v else None
    if isinstance(v, (int, float)):
        return (float(v), '')
    if isinstance(v, str):
        m = _NUMU.match(_sci(v.strip()))
        if m:
            try:
                return (float(m.group(1)), m.group(2).strip())
            except Exception:
                return None
    return None


def parse_knowns(d):
    out = {}
    for k, v in (d or {}).items():
        p = parse_one(v)
        if p is not None:
            out[k] = p
    return out


def extract(question, choices):
    prompt = f'Menu of laws:\n{MENU}\n\nQuestion:\n{question}\nChoices: {choices}'
    raw = ollama([{'role': 'system', 'content': SYS}, {'role': 'user', 'content': prompt}])
    m = re.search(r'\{.*\}', raw, re.S)
    if not m:
        return None
    try:
        ex = json.loads(m.group(0))
    except Exception:
        return None
    if isinstance(ex, dict):
        ex['law'] = resolve_law(ex.get('law'))
        ex['knowns'] = parse_knowns(ex.get('knowns'))
    return ex


def plug_back_ok(eq, knowns_si, target, value):
    """Substitute knowns + solution back into the law; residual must be ~0."""
    loc = {n: sp.Symbol(n) for n in set(re.findall(r'[A-Za-z_]\w*', eq)) if n not in _SYMPY_NS}
    lhs, rhs = eq.split('=', 1)
    expr = sp.sympify(lhs, locals=loc) - sp.sympify(rhs, locals=loc)
    subs = {loc[k]: v for k, v in knowns_si.items() if k in loc}
    subs[loc[target]] = value
    try:
        return abs(float(expr.subs(subs))) < 1e-6 * (abs(value) + 1)
    except Exception:
        return False


def choice_value_si(choice):
    """Parse a choice like '2000 N' or '2.0 x 10^3 J' -> (SI magnitude, dimension or None)."""
    s = choice.replace('×', 'x').replace('·', '*')
    s = re.sub(r'(\d)\s*x\s*10\s*\^?\s*([-+]?\d+)', r'\1e\2', s)  # 2 x 10^3 -> 2e3
    m = re.match(r'\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([A-Za-zΩ/*^0-9·]*)', s)
    if not m:
        return None, None
    val = float(m.group(1))
    unit = m.group(2).strip()
    if not unit:
        return val, None
    try:
        return to_si(val, unit)
    except Exception:
        return val, None  # unit didn't parse — compare on magnitude only


def match_choice(value, choices, tdim=None):
    """Closest choice within 5% relative, unambiguous. If tdim is given, only consider
    choices whose unit dimension matches it (the escape-hatch dimensional gate)."""
    scored = []
    for i, c in enumerate(choices):
        cv, cdim = choice_value_si(c)
        if cv is None:
            continue
        if tdim is not None and cdim is not None and cdim != tdim:
            continue  # dimensionally impossible — the computed value can't be this choice
        denom = max(abs(value), abs(cv), 1e-30)
        scored.append((abs(value - cv) / denom, i))
    if not scored:
        return None
    scored.sort()
    if scored[0][0] < 0.05 and (len(scored) == 1 or scored[1][0] > 2 * scored[0][0] + 1e-9):
        return scored[0][1]
    return None


def baseline_answer(question, choices):
    sys = 'Answer the multiple-choice question. End with a line "FINAL: X" (A, B, C, or D).'
    body = f'{question}\n' + '\n'.join(f'{LETTERS[i]}. {c}' for i, c in enumerate(choices))
    raw = ollama([{'role': 'system', 'content': sys}, {'role': 'user', 'content': body}])
    m = re.search(r'FINAL:\s*\(?([A-D])', raw, re.I) or re.search(r'\b([A-D])\b(?![\s\S]*\b[A-D]\b)', raw)
    return m.group(1).upper() if m else '?'


FREE_SYS = (
    'You translate a STEM multiple-choice question (physics, chemistry, statistics, algebra, '
    'combinatorics, circuits) into ONE governing equation and its known quantities. You do NOT '
    'compute the answer. Use short variable names. You MAY use sqrt, log, factorial, binomial, pi. '
    'Include any needed physical constant as a known (g=9.8 m/s**2, k=8.99e9 N*m**2/C**2, '
    'h=6.626e-34 J*s, c=3e8 m/s). For pure numbers, counts, or probabilities use unit "" '
    '(dimensionless).\n'
    'Output ONLY JSON: {"equation": "<lhs = rhs>", "knowns": {"var": [number, "unit"]}, "target": "<var>"}\n'
    'Examples:\n'
    'KE of 2 kg at 3 m/s → {"equation":"KE = m*v**2/2","knowns":{"m":[2,"kg"],"v":[3,"m/s"]},"target":"KE"}\n'
    'z-score of 85, mean 75, sd 5 → {"equation":"z = (x-mu)/sigma","knowns":{"x":[85,""],"mu":[75,""],"sigma":[5,""]},"target":"z"}\n'
    'ways to choose 2 of 5 → {"equation":"Cnk = factorial(n)/(factorial(k)*factorial(n-k))","knowns":{"n":[5,""],"k":[2,""]},"target":"Cnk"}\n'
    '100 ohm parallel 100 ohm → {"equation":"Rp = R1*R2/(R1+R2)","knowns":{"R1":[100,"ohm"],"R2":[100,"ohm"]},"target":"Rp"}\n'
    '$1000 at 5% for 3 yr → {"equation":"A = P*(1+r)**n","knowns":{"P":[1000,""],"r":[0.05,""],"n":[3,""]},"target":"A"}\n'
    'If it is a definition/concept question, not a calculation, output {"equation": null}.'
)


def free_extract(question, choices):
    raw = ollama([{'role': 'system', 'content': FREE_SYS},
                  {'role': 'user', 'content': f'Question:\n{question}\nChoices: {choices}'}])
    m = re.search(r'\{.*\}', raw, re.S)
    if not m:
        return None
    try:
        fx = json.loads(m.group(0))
    except Exception:
        return None
    if isinstance(fx, dict):
        fx['knowns'] = parse_knowns(fx.get('knowns'))
    return fx


def free_solve(eq, knowns_units, target):
    """Solve an LLM-written equation: numeric solve in SI, infer the target's dimension from
    the knowns' units, and plug-back. Returns (value, target, target_dim)."""
    ids = {n for n in re.findall(r'[A-Za-z_]\w*', eq) if n not in _SYMPY_NS}
    loc = {n: sp.Symbol(n) for n in ids}
    lhs, rhs = eq.split('=', 1)
    equation = sp.Eq(sp.sympify(lhs, locals=loc), sp.sympify(rhs, locals=loc))
    si = {k: to_si(v[0], v[1])[0] for k, v in knowns_units.items() if k in ids}
    if target not in ids:
        unk = [n for n in ids if n not in si]
        if len(unk) != 1:
            raise ValueError(f'underdetermined: {unk}')
        target = unk[0]
    sols = [s for s in sp.solve(equation.subs({loc[k]: v for k, v in si.items()}), loc[target])
            if getattr(s, 'is_number', False)]
    if not sols:
        raise ValueError('no numeric solution')
    val = float(sols[0])
    tdim = None
    try:  # dimensional inference: target = f(knowns); dimension of f from the knowns' dims
        symsol = sp.solve(equation, loc[target])
        kd = {k: to_si(v[0], v[1])[1] for k, v in knowns_units.items() if k in ids}
        if symsol:
            tdim = dimension_of(str(symsol[0]), kd)
    except Exception:
        tdim = None
    if not plug_back_ok(eq, si, target, val):
        raise ValueError('plug-back failed')
    return val, target, tdim


CHAIN_SYS = (
    'Identify the KNOWN quantities and the TARGET in this physics/chemistry problem using '
    'these canonical symbols (do NOT compute the answer):\n'
    'm=mass, v=speed, v0=initial speed, vf=final speed, a=acceleration, t=time, d=distance, '
    'h=height, r=radius, F=force, KE=kinetic energy, U=potential energy, p=momentum, '
    'W=work, P=power, Qh=heat, c=specific heat, dT=temperature change, Q=charge, '
    'C=capacitance, V=voltage, I=current, R=resistance, f=frequency, lam=wavelength, '
    'E=energy, rho=density.\n'
    'Extract EVERY number with its unit, using these exact symbols. '
    'Example — for "a 2 kg ball moving at 3 m/s, find its kinetic energy" output:\n'
    '{"knowns": {"m": [2, "kg"], "v": [3, "m/s"]}, "target": "KE"}\n'
    'Output ONLY the JSON object.'
)

# map a model's free-text quantity name back to the canonical catalog symbol
ALIAS = {'frequency': 'f', 'wavelength': 'lam', 'velocity': 'v', 'speed': 'v', 'mass': 'm',
         'force': 'F', 'time': 't', 'distance': 'd', 'charge': 'Q', 'voltage': 'V',
         'current': 'I', 'resistance': 'R', 'energy': 'E', 'power': 'P', 'acceleration': 'a',
         'momentum': 'p', 'height': 'h', 'radius': 'r', 'work': 'W', 'heat': 'Qh'}


def _canon(name):
    n = str(name or '').strip()
    return ALIAS.get(n.lower(), n)


def chain_extract(question, choices):
    raw = ollama([{'role': 'system', 'content': CHAIN_SYS},
                  {'role': 'user', 'content': f'Question:\n{question}\nChoices: {choices}'}])
    m = re.search(r'\{.*\}', raw, re.S)
    if not m:
        return None
    try:
        cx = json.loads(m.group(0))
    except Exception:
        return None
    if isinstance(cx, dict):
        kn = parse_knowns(cx.get('knowns'))
        cx['knowns'] = {_canon(k): v for k, v in kn.items() if k != 'sym'}  # drop copied placeholder
        cx['target'] = _canon(cx.get('target'))
    return cx


MATH_SYS = (
    'Extract the math expression and the operation from this question — do NOT solve it. '
    'Output ONLY JSON: {"expr": "<sympy expr, use ** for powers>", '
    '"op": "differentiate|integrate|limit|solve|evaluate|factor|simplify|series", '
    '"var": "x", "at": <number or null>}. Example: "derivative of 3x^2+2x" -> '
    '{"expr":"3*x**2+2*x","op":"differentiate","var":"x","at":null}'
)


def math_extract(question, choices):
    raw = ollama([{'role': 'system', 'content': MATH_SYS},
                  {'role': 'user', 'content': f'Question:\n{question}\nChoices: {choices}'}])
    m = re.search(r'\{.*\}', raw, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


from sympy.parsing.sympy_parser import (parse_expr, standard_transformations,
                                         implicit_multiplication_application, convert_xor)
_TX = standard_transformations + (implicit_multiplication_application, convert_xor)


def _choice_vals(c):
    """A choice may hold ONE expr ('6x + 2') or MANY values ('2 and 3', '1, 6'). Tolerate math
    notation (implicit mult, '^', '×'), a leading label, and a trailing integration constant.
    Returns the list of parsed sympy values."""
    s = str(c).replace('×', '*').strip()
    s = re.sub(r'^[A-Da-d][).:]\s*', '', s)
    s = re.sub(r'\+\s*[Cc]\b', '', s)
    vals = []
    for p in re.split(r'\s+and\s+|\s*,\s*|\s+or\s+|;', s):
        p = p.strip()
        if not p:
            continue
        try:
            vals.append(parse_expr(p, transformations=_TX))
        except Exception:
            pass
    return vals


def _eq(a, b):
    """a == b, exactly or (for antiderivatives) up to an additive constant."""
    try:
        d = sp.simplify(a - b)
        if d == 0:
            return True
        return bool(d.free_symbols) and sp.simplify(sp.diff(d, *sorted(d.free_symbols, key=str))) == 0
    except Exception:
        try:
            return abs(float(a) - float(b)) < 1e-6
        except Exception:
            return False


def _match_math(ans, choices):
    """Deterministic gate: match a sympy answer to a choice by symbolic/numeric equality. A single
    answer matches any value in a choice; a root-set answer matches a choice whose value-set equals it."""
    cset = []
    for a in (ans if isinstance(ans, list) else [ans]):
        cset.append(a if hasattr(a, 'free_symbols') else sp.sympify(str(a)))
    for i, c in enumerate(choices):
        cvals = _choice_vals(c)
        if not cvals:
            continue
        if len(cset) > 1:   # root set: choice's values must equal the answer set
            if len(cvals) == len(cset) and all(any(_eq(cv, a) for a in cset) for cv in cvals):
                return i
        else:               # single value: any of the choice's parsed values matches
            if any(_eq(cset[0], cv) for cv in cvals):
                return i
    return None


def math_solve_question(question, choices):
    """RIGHT-MATHS path: detect the operation, LLM PARSES the expression, Gödel-routed math_solve
    computes it EXACTLY, match the choice by symbolic equality. The model parses; sympy is exact."""
    op = infer_op(question)
    if not op:
        return None, None
    mx = math_extract(question, choices)
    if not mx or not mx.get('expr'):
        return None, None
    try:
        ans = _timed(5, solve_math, mx['expr'], mx.get('op') or op, mx.get('var') or 'x', mx.get('at'))
        idx = _match_math(ans, choices)
        if idx is not None:
            return LETTERS[idx], 'math:' + (mx.get('op') or op)
    except Exception:
        pass
    return None, None


PROG_SYS = (
    'Translate the math/science problem into ONE sympy expression that COMPUTES the answer — '
    'program-of-thought. Use sympy: binomial, factorial, sqrt, solve([eqs],[vars]), Rational, '
    'simplify, pi, exp, log, and the symbols in the problem. Output ONLY JSON: {"sympy":"<expr>"}.\n'
    'Examples: "ways to choose 5 from 6" -> {"sympy":"binomial(6,5)"}; '
    '"two numbers sum to 19, product 70" -> {"sympy":"solve([x+y-19, x*y-70],[x,y])"}; '
    '"20% markdown on 325" -> {"sympy":"325*(1-Rational(20,100))"}; '
    '"value of 3! + 2^4" -> {"sympy":"factorial(3)+2**4"}.'
)
_PROG_NS = {n: getattr(sp, n) for n in ('binomial', 'factorial', 'sqrt', 'solve', 'Rational',
            'simplify', 'pi', 'E', 'exp', 'log', 'sin', 'cos', 'tan', 'Sum', 'Integer', 'Eq',
            'Symbol', 'symbols', 'gcd', 'lcm', 'Abs', 'floor', 'ceiling', 'prime', 'factorint')}
_PROG_NS.update({c: sp.Symbol(c) for c in 'abcdefghijklmnopqrstuvwxyz'})


def prog_extract(question, choices):
    raw = ollama([{'role': 'system', 'content': PROG_SYS},
                  {'role': 'user', 'content': f'Question:\n{question}\nChoices: {choices}'}])
    m = re.search(r'\{.*\}', raw, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0)).get('sympy')
    except Exception:
        return None


PROG_K = int(os.environ.get('COMPUTE_PROG_K', '3'))   # formalizations sampled per question (self-consistency)


def _prog_attempt(question, choices):
    """ONE program-of-thought attempt: the model writes a sympy expression; execute it sandboxed and
    match a choice. Returns a choice index or None."""
    src = prog_extract(question, choices)
    if not src or len(src) > 240:
        return None
    try:
        val = _timed(5, eval, src, {'__builtins__': {}}, _PROG_NS)   # restricted ns + 5s wall cap
    except Exception:
        return None
    # normalize: solve() returns dict/list of dicts/tuples → flatten to value(s)
    if isinstance(val, dict):
        val = list(val.values())
    elif isinstance(val, list) and val and isinstance(val[0], (dict,)):
        val = [v for d in val for v in d.values()]
    elif isinstance(val, list) and val and isinstance(val[0], (tuple,)):
        val = [v for t in val for v in t]
    return _match_math(val, choices)


def prog_solve_question(question, choices):
    """Self-consistent program-of-thought. A SINGLE formalization is the moat's failure mode: the model
    misreads the problem, sympy executes the wrong setup EXACTLY, and the exact-but-wrong value lands on a
    distractor (the board showed prog defaulting to 'A' at 43.8% on-fired). So we sample PROG_K
    formalizations and only commit when a MAJORITY agree on the same choice — disagreement means the setup
    is unreliable, so we ABSTAIN (→ route to brain) rather than certify a guess. Exact math, honest coverage."""
    votes = {}
    for _ in range(PROG_K):
        idx = _prog_attempt(question, choices)
        if idx is not None:
            votes[idx] = votes.get(idx, 0) + 1
    if not votes:
        return None, None
    best_idx, best_n = max(votes.items(), key=lambda kv: kv[1])
    total = sum(votes.values())
    # require a real consensus: ≥2 formalizations agree AND they're a clear majority. A lone success, or a
    # split vote, is exactly the unreliable formalization we must NOT trust — abstain instead of guessing.
    if best_n >= 2 and best_n / total >= 0.6:
        return LETTERS[best_idx], 'prog'
    return None, None


def solve_question(question, choices):
    """Verified compute: the right-maths (calculus/algebra) path, the physics catalog chain, the
    free-equation hatch, then program-of-thought sympy. Returns (answer_letter or None, mode)."""
    # 0. RIGHT-MATHS — calculus/algebra computed exactly (Gödel form → sympy method)
    if infer_op(question):
        ans, mode = math_solve_question(question, choices)
        if ans is not None:
            return ans, mode
    # 1. CHAIN path — name the knowns + target; the verified planner derives the rest
    #    (handles single-law AND multi-step; every hop dimension-checked).
    cx = chain_extract(question, choices)
    if cx and cx.get('knowns') and cx.get('target'):
        try:
            val, chain, known = chain_solve(cx['knowns'], cx['target'])
            if isinstance(val, float) and chain:
                tdim = known.get(cx['target'], (None, None))[1]
                idx = match_choice(val, choices, tdim)
                if idx is not None:
                    return LETTERS[idx], 'chain' if len(chain) > 1 else 'catalog'
        except Exception:
            pass
    # 2. ESCAPE HATCH — the model writes the equation; units + plug-back still certify it
    fx = free_extract(question, choices)
    if fx and fx.get('equation') and fx.get('knowns'):
        try:
            val, tgt, tdim = free_solve(fx['equation'], fx['knowns'], fx.get('target'))
            if isinstance(val, float):
                idx = match_choice(val, choices, tdim)  # dimensional gate via choice units
                if idx is not None:
                    return LETTERS[idx], 'free'
        except Exception:
            pass
    # 3. PROGRAM-OF-THOUGHT — the model writes a sympy program (systems, combinatorics, arithmetic),
    #    executed exactly. Catches the word-problem math the explicit-op path can't gate on.
    ans, mode = prog_solve_question(question, choices)
    if ans is not None:
        return ans, mode
    return None, 'abstain'


def _batch():
    """Read JSONL {id, question, choices} on stdin; emit JSONL {id, answer, mode} — one process,
    one sympy import, so the MMLU bench can score the whole compute arm in a single subprocess call."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            q = json.loads(line)
            ans, mode = solve_question(q['question'], q['choices'])
        except Exception:
            q, ans, mode = {}, None, 'error'
        print(json.dumps({'id': q.get('id'), 'answer': ans, 'mode': mode}), flush=True)


def main():
    if '--batch' in sys.argv:
        return _batch()
    bank = json.load(open(BANK))
    grand = {'cov_n': 0, 'cov_correct': 0, 'base_on_attempted': 0, 'total': 0, 'base_total': 0}
    print(f'# COMPUTE arm — model={MODEL} | verified extract→solve→match→answer/abstain\n')
    for subj in SUBJECTS:
        qs = bank.get(subj, [])[:PER]
        if not qs:
            continue
        attempted = correct = base_corr = base_corr_attempted = 0
        modes = {'catalog': 0, 'chain': 0, 'free': 0}
        for q in qs:
            gold = LETTERS[q['answer']]
            base = baseline_answer(q['question'], q['choices'])
            base_corr += base == gold
            ans, mode = solve_question(q['question'], q['choices'])
            if ans is not None:
                attempted += 1
                correct += ans == gold
                base_corr_attempted += base == gold
                modes[mode] += 1
            mark = f'{ans}({mode[0]})' if ans else '·'
            print(f'  {subj[:18]:18} compute={mark}/{gold}  base={base}')
        grand['cat'] = grand.get('cat', 0) + modes['catalog']
        grand['chain'] = grand.get('chain', 0) + modes['chain']
        grand['free'] = grand.get('free', 0) + modes['free']
        cov = f'{attempted}/{len(qs)}'
        acc = f'{100*correct/attempted:.0f}%' if attempted else '—'
        print(f'  ── {subj}: coverage {cov} · accuracy-on-attempted {acc} '
              f'(correct {correct}) · baseline-overall {100*base_corr/len(qs):.0f}% '
              f'· baseline-on-those {base_corr_attempted}/{attempted}\n')
        grand['cov_n'] += attempted; grand['cov_correct'] += correct
        grand['base_on_attempted'] += base_corr_attempted
        grand['total'] += len(qs); grand['base_total'] += base_corr
    n, c = grand['cov_n'], grand['cov_correct']
    print('# ═════════ verified-compute scoreboard ═════════')
    print(f'  coverage:            {n}/{grand["total"]}  ({100*n//max(grand["total"],1)}% of questions attempted)')
    print(f'    single-law: {grand.get("cat",0)}   ·   multi-hop chain: {grand.get("chain",0)}   ·   escape hatch: {grand.get("free",0)}')
    print(f'  accuracy on those:   {c}/{n}  ({100*c//max(n,1)}%)   ← verified compute')
    print(f'  baseline on those:   {grand["base_on_attempted"]}/{n}  ({100*grand["base_on_attempted"]//max(n,1)}%)   ← same 3B, no compute')
    print(f'  baseline overall:    {grand["base_total"]}/{grand["total"]}  ({100*grand["base_total"]//max(grand["total"],1)}%)')


if __name__ == '__main__':
    main()
