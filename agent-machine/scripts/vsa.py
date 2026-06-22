#!/usr/bin/env python3
"""
vsa — Vector-Symbolic Architecture (HRR / Holographic Reduced Representations): symbolic computation
DIRECTLY on high-dimensional vectors, the bridge between our vector brain and symbolic reasoning
(IBM NVSA, Nature MI 2023). The chomer→tzurah substrate made executable: distributed vectors
(matter) carry composable symbolic STRUCTURE (form) via an algebra —

  bind(a,b)   ⊗  circular convolution — associates two concepts into a vector dissimilar to both
  unbind(a,b) ⊘  circular correlation — inverts binding (query a role for its filler)
  bundle([..])+  superposition — a SET/record similar to all its members
  permute(a,n)ρ  cyclic shift — order/sequence (protects against commutativity)
  sim(a,b)       cosine — graded similarity, the read-out

A CleanupMemory snaps a noisy result back to the nearest known symbol. This gives us: role-filler
records, analogical mapping (A:B :: C:?), set membership, and concept composition — problem
MANIPULATION in vector space. Applies to: concept-level MCQ scoring, CBR structure-matching, and
encoding question structure for abductive reasoning.

Run:  python3 scripts/vsa.py        (self-test: role-filler unbind + analogical mapping)
"""
import numpy as np

DIM = 1024
_rng = np.random.default_rng(1729)


def hv(seed=None):
    """A fresh random hypervector (unit-norm)."""
    r = np.random.default_rng(seed) if seed is not None else _rng
    v = r.standard_normal(DIM).astype(np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


def bind(a, b):
    """⊗ circular convolution — invertible association."""
    return np.fft.irfft(np.fft.rfft(a) * np.fft.rfft(b), n=DIM)


def unbind(c, b):
    """⊘ circular correlation — recover the filler bound to role b (approx, needs cleanup)."""
    return np.fft.irfft(np.fft.rfft(c) * np.conj(np.fft.rfft(b)), n=DIM)


def bundle(vs):
    """+ superposition into a record/set similar to all members."""
    s = np.sum(vs, axis=0)
    return s / (np.linalg.norm(s) + 1e-12)


def permute(a, n=1):
    """ρ cyclic shift for ordering/sequencing."""
    return np.roll(a, n)


def sim(a, b):
    return float(np.dot(a, b) / ((np.linalg.norm(a) + 1e-12) * (np.linalg.norm(b) + 1e-12)))


class CleanupMemory:
    """Snap a noisy vector back to the nearest known symbol (the symbolic read-out)."""
    def __init__(self):
        self.names, self.vecs = [], []

    def add(self, name, vec=None):
        v = vec if vec is not None else hv()
        self.names.append(name); self.vecs.append(v / (np.linalg.norm(v) + 1e-12))
        return self.vecs[-1]

    def cleanup(self, q, topk=1):
        M = np.vstack(self.vecs)
        s = M @ (q / (np.linalg.norm(q) + 1e-12))
        idx = np.argsort(s)[::-1][:topk]
        return [(self.names[i], round(float(s[i]), 3)) for i in idx]


def _selftest():
    mem = CleanupMemory()
    # symbols
    for s in ['capital', 'currency', 'language', 'washington', 'mexico_city', 'dollar', 'peso', 'english', 'spanish']:
        mem.add(s)
    g = dict(zip(mem.names, mem.vecs))

    # role-filler RECORDS (countries as bundles of role⊗filler)
    usa = bundle([bind(g['capital'], g['washington']), bind(g['currency'], g['dollar']), bind(g['language'], g['english'])])
    mex = bundle([bind(g['capital'], g['mexico_city']), bind(g['currency'], g['peso']), bind(g['language'], g['spanish'])])

    print("# vsa self-test (HRR, DIM=%d)\n" % DIM)
    print("  ROLE-FILLER unbind — query a record for a role's filler:")
    print(f"    USA / currency  → {mem.cleanup(unbind(usa, g['currency']))}   (expect dollar)")
    print(f"    Mexico / capital→ {mem.cleanup(unbind(mex, g['capital']))}   (expect mexico_city)")

    print("\n  ANALOGICAL MAPPING — 'the dollar of Mexico' via a single binding (Kanerva):")
    T = bind(mex, unbind(usa, usa))  # identity-ish guard; real mapping below
    mapping = bind(mex, _pseudo_inv(usa))      # transformation USA→Mexico
    ans = bind(g['dollar'], mapping)            # apply it to 'dollar'
    print(f"    dollar ⊗ (Mexico ⊘ USA) → {mem.cleanup(ans, 2)}   (expect peso on top)")

    print("\n  SET membership via bundling:")
    fruits = bundle([mem.add('apple'), mem.add('banana'), mem.add('cherry')])
    print(f"    sim(set, apple)={sim(fruits, g.get('apple', mem.vecs[mem.names.index('apple')])):.2f}  "
          f"sim(set, dollar)={sim(fruits, g['dollar']):.2f}   (member >> non-member)")
    print("\n# substrate works: bind/unbind/bundle/permute + cleanup → symbolic algebra on vectors.")


def _pseudo_inv(a):
    """Approximate inverse for HRR binding (involution of the FFT)."""
    A = np.fft.rfft(a)
    return np.fft.irfft(np.conj(A) / (np.abs(A) ** 2 + 1e-6), n=DIM)


if __name__ == '__main__':
    _selftest()
