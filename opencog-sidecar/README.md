# HellGraph OpenCog Sidecar

A FastAPI service that hosts a **real OpenCog AtomSpace** and exposes its
reasoning engines (Pattern Matcher, PLN, ECAN, URE) over HTTP. HellGraph (the
TypeScript metagraph in `lib/hellgraph/`) is the system-of-record substrate;
this sidecar is the inference co-processor and the bridge to native OpenCog
federation.

Atoms move between HellGraph and the sidecar as **Atomese** (s-expressions) —
the same format HellGraph's codec (`lib/hellgraph/atomese.ts`) emits — so the
two AtomSpaces round-trip losslessly.

## Why a sidecar

The pure-TS engine in `lib/hellgraph/` already does storage, the RDF/SPARQL and
Gremlin projections, and a native hypergraph **Pattern Matcher**. What it does
*not* reimplement is OpenCog's mature probabilistic reasoning:

- **PLN** — Probabilistic Logic Networks (forward/backward chaining over TruthValues)
- **ECAN** — Economic Attention Networks (importance spreading)
- **URE** — Unified Rule Engine

Those run here, in the genuine OpenCog stack, and HellGraph delegates to them.

## Install

The Python deps are trivial; the OpenCog stack is not pip-installable as a wheel
on all platforms. Pick one:

```bash
# 1) HTTP service deps (always)
pip install -r requirements.txt

# 2) OpenCog stack — choose one:
#    a. conda (simplest)
conda install -c opencog atomspace cogutil ure pln attention

#    b. from source (most control)
#       build order: cogutil → atomspace → ure → pln → attention
#       https://github.com/opencog/atomspace

#    c. docker base image
#       docker pull opencog/opencog-deps
```

The sidecar **detects OpenCog at runtime**. If it is absent, `/health` reports
`available: false` and the reasoning endpoints return `503` — HellGraph then
falls back to its built-in TS pattern matcher with no crash.

## Run

```bash
uvicorn server:app --host 127.0.0.1 --port 8137
# or
HELLGRAPH_SIDECAR_PORT=8137 python server.py
```

Point the TS runtime at it (defaults to `http://127.0.0.1:8137`):

```bash
export HELLGRAPH_SIDECAR_URL=http://127.0.0.1:8137
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Availability, atom count, engine capabilities |
| POST | `/atomese/load` | Define atoms from Atomese text |
| GET  | `/atomese/dump` | Export the AtomSpace as Atomese |
| POST | `/pattern` | Run a BindLink/GetLink (Pattern Matcher) |
| POST | `/pln/forward` | PLN forward chaining |
| POST | `/ecan/stimulate` | Set short-term importance (ECAN) |
| POST | `/scheme` | Evaluate arbitrary Atomese/Scheme |

The TS client lives at `lib/hellgraph/sidecar.ts`; the Next.js bridge route is
`POST /api/graph/reason` (`op: health | sync | pattern | pln | ecan`).

## Federation without the sidecar

If a CogServer is already running, `lib/hellgraph/cogserver.ts` speaks its TCP
Scheme protocol directly (default port 17001) — `pushToCogServer()` and
`executeOnCogServer()` — no Python process required.
