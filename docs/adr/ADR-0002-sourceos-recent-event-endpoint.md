# ADR-0002: SourceOS Recent Event Endpoint

Status: proposed  
Issue: `SocioProphet/Noetica#50`

## Context

Noetica now has a bounded `SourceOSInteractionEvent` artifact export path:

- `ADR-0001` selected local artifact export as the first runtime bridge mechanism.
- `scripts/export-sourceos-interaction-events.mjs` exports bounded event artifacts.
- `scripts/sourceos-event-export-path.mjs` resolves development and workstation app-data paths.
- AgentTerm imports exported artifacts through an opt-in pull/import command.

The remaining question is whether Noetica should expose recent interaction events through a local endpoint such as:

```text
GET /events
GET /events/:interactionEventId
GET /events/recent?limit=N
```

## Decision

Do not add a recent-event endpoint yet.

Noetica should keep bounded artifact export as the only supported SourceOS interaction runtime bridge until the durable event-store decision is settled in `SocioProphet/Noetica#51`.

## Rationale

Endpoint serving introduces retention, indexing, access, lifecycle, and local-service availability semantics. Those semantics overlap with the unresolved OpsHistory / SourceOS durability decision.

Deferring endpoint serving prevents Noetica from accidentally becoming a durable event authority or a local event API authority before the storage boundary is settled.

The current artifact bridge is sufficient for the near term because it:

- gives deterministic event artifacts;
- is easy to validate in CI;
- supports AgentTerm pull/import without runtime coupling;
- avoids live stream semantics;
- avoids local API lifecycle commitments;
- keeps retention and durability decisions explicit.

## Rejected now

### `GET /events`

Rejected for now because it implies a queryable event collection and retention model.

### `GET /events/:interactionEventId`

Rejected for now because event identity lookup requires an index or durable store decision.

### `GET /events/recent?limit=N`

Rejected for now because recency semantics require ordering, retention, and truncation rules.

## Required condition for reconsideration

Reconsider a local endpoint only after `SocioProphet/Noetica#51` resolves whether Noetica should:

1. remain artifact-only;
2. index artifact exports;
3. append to OpsHistory;
4. delegate durability to SourceOS / sourceos-syncd / another plane.

## Boundary rules

- No SSE/WebSocket is introduced by this decision.
- No remote exposure is introduced by this decision.
- No AgentTerm default dependency is introduced by this decision.
- No durable system-of-record claim is introduced by this decision.
- No raw transcripts, private reasoning, raw shell output, browser history, secrets, credentials, unrestricted provider payloads, or raw execution logs are valid endpoint payloads if a future endpoint is added.

## Follow-on

`SocioProphet/Noetica#51` remains the next required decision before endpoint work can be reopened.
