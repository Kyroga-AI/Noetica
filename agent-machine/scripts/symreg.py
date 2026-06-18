#!/usr/bin/env python3
"""
symreg.py — symbolic regression (SINDy-style sparse fit) + ridge-delta tracking
for the compounding learn-from-failure loop.

Two jobs:
  1) symbolic_regress: given numeric examples (X, y), build a library of candidate
     terms (polynomials/products), fit sparse coefficients (STLSQ — sequentially
     thresholded least squares, the SINDy core), and return the recovered symbolic
     law + R^2. This is where we recover governing relations from worked examples.

  2) ridge_delta: given per-concept scores before and after a remediation lesson,
     fit a Ridge regression of the improvement (post - pre) so we can quantify and
     report the "missed lesson" delta that gets written back for the next pass.

CLI: reads a JSON job on stdin, writes JSON result to stdout.
  {"op":"symbolic_regress","feature_names":["t"],"X":[[1],[2],[3]],"y":[9.8,19.6,29.4]}
  {"op":"ridge_delta","concepts":[...],"pre":[...],"post":[...],"features":[[...],...]}
"""
import sys, json, itertools
import numpy as np
import sympy as sp


def _library(X, names, degree=2):
    """Polynomial + pairwise-product feature library up to `degree`."""
    n, d = X.shape
    feats = [np.ones(n)]
    syms = [sp.Integer(1)]
    xs = [sp.Symbol(nm) for nm in names]
    # degree-1..degree monomials over the d variables
    for deg in range(1, degree + 1):
        for combo in itertools.combinations_with_replacement(range(d), deg):
            col = np.ones(n)
            term = sp.Integer(1)
            for idx in combo:
                col = col * X[:, idx]
                term = term * xs[idx]
            feats.append(col)
            syms.append(term)
    return np.array(feats).T, syms


def _stlsq(Theta, y, thresh=0.1, iters=10):
    """Sequentially thresholded least squares (SINDy sparsity)."""
    coef, *_ = np.linalg.lstsq(Theta, y, rcond=None)
    for _ in range(iters):
        small = np.abs(coef) < thresh
        coef[small] = 0
        big = ~small
        if not big.any():
            break
        coef[big], *_ = np.linalg.lstsq(Theta[:, big], y, rcond=None)
    return coef


def symbolic_regress(job):
    X = np.array(job["X"], dtype=float)
    y = np.array(job["y"], dtype=float)
    names = job.get("feature_names") or [f"x{i}" for i in range(X.shape[1])]
    degree = int(job.get("degree", 2))
    thresh = float(job.get("threshold", 0.1))
    Theta, syms = _library(X, names, degree)
    coef = _stlsq(Theta, y, thresh)
    expr = sum((sp.Float(round(float(c), 4)) * s for c, s in zip(coef, syms) if c != 0), sp.Integer(0))
    pred = Theta @ coef
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2)) or 1e-12
    return {"law": str(sp.simplify(expr)), "r2": round(1 - ss_res / ss_tot, 4),
            "terms": [(str(s), round(float(c), 4)) for c, s in zip(coef, syms) if c != 0]}


def ridge_delta(job):
    from sklearn.linear_model import Ridge
    pre = np.array(job["pre"], dtype=float)
    post = np.array(job["post"], dtype=float)
    delta = post - pre
    feats = np.array(job.get("features") or [[1.0]] * len(pre), dtype=float)
    model = Ridge(alpha=float(job.get("alpha", 1.0)))
    model.fit(feats, delta)
    return {
        "mean_delta": round(float(np.mean(delta)), 4),
        "per_concept_delta": [round(float(d), 4) for d in delta],
        "ridge_coef": [round(float(c), 4) for c in np.atleast_1d(model.coef_)],
        "ridge_intercept": round(float(model.intercept_), 4),
        "total_lessons_written_back": int(np.sum(delta > 0)),
    }


if __name__ == "__main__":
    job = json.load(sys.stdin)
    op = job.get("op")
    out = symbolic_regress(job) if op == "symbolic_regress" else ridge_delta(job) if op == "ridge_delta" else {"error": f"unknown op {op}"}
    print(json.dumps(out))
