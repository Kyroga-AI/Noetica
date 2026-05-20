# Noetica

Noetica is the governed chat surface for the SocioProphet / SourceOS stack.

It is designed to operate in two modes:

- **standalone** — direct provider calls through local API keys.
- **sourceos** — submission through Superconscious, with model routing, policy admission, memory scope, and evidence references surfaced back into the UI.

The M1 scaffold establishes the application shell, typed provider boundary, Superconscious adapter contract, steering UX placeholders, governance trail display, and model registry. Real memory ownership, model routing authority, policy admission authority, and evidence persistence remain outside this repository.

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Zustand

## Authority boundaries

Noetica owns the chat surface, provider abstraction, steering UX, governance trail display, and Superconscious adapter interface.

Noetica does **not** own memory, model routing, policy admission, or agent evidence authority. Those remain delegated to `memory-mesh`, `model-router`, `guardrail-fabric`, and `agentplane` respectively.

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and provide provider keys for standalone mode.

## M1 surfaces

- `app/api/chat/route.ts` — standalone provider routing and SourceOS adapter entrypoint.
- `app/api/steer/route.ts` — Neuronpedia steering proxy boundary.
- `config/models.ts` — governed model registry.
- `lib/superconscious/adapter.ts` — SourceOS contract stub.
- `components/governance/GovernanceTrail.tsx` — user-visible governance trace.
