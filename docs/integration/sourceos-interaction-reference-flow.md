# SourceOS Interaction Reference Flow

Status: downstream surface pointer  
Canonical packet: `SourceOS-Linux/sourceos-spec#118`  
Canonical manifest: `examples/interaction-flow/noetica-superconscious-agentplane-agentterm.flow.json`

## Noetica role

Noetica is the browser chat and inline governance-trail surface for the SourceOS interaction substrate.

In the canonical reference flow, Noetica emits `SourceOSInteractionEvent` from chat lifecycle paths. The event is then carried through Superconscious task-boundary binding, AgentPlane evidence binding, and AgentTerm terminal rendering.

```text
Noetica emits SourceOSInteractionEvent
  -> Superconscious binds task boundary
  -> AgentPlane attaches evidence and replay refs
  -> AgentTerm renders and records governance trace
```

## Local obligations

Noetica must:

- emit `SourceOSInteractionEvent` for chat lifecycle events;
- expose the event-derived governance trace in UI responses;
- keep `lib/contracts/sourceos/generated/sourceos-interaction-event.ts` synced to the pinned `sourceos-spec` artifact;
- avoid claiming policy, grant, memory, AgentPlane evidence, or SourceOS schema authority.

## Contract sync

Check the vendored contract:

```bash
node scripts/sync-sourceos-contracts.mjs --check
```

Refresh the vendored contract from the pinned `sourceos-spec` commit:

```bash
node scripts/sync-sourceos-contracts.mjs --write
```

## Authority boundary

Noetica owns UI-level chat affordances and inline governance rendering. It does not own Policy Fabric admission, Agent Registry grants, Memory Mesh durable memory/context packs, AgentPlane execution evidence, Superconscious task coordination, or the canonical `SourceOSInteractionEvent` schema.
