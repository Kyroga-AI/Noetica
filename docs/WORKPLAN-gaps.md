# Noetica gap work-plan (2026-06-22)

Enumerated gaps from outside-in research sweeps + the user's specific callouts (graph DB, UI, ontology
integration). Ordered by leverage. "Implemented" = landed in code; "Planned" = scoped, not yet built.

## A. Ontology integration (ontogenesis / GAIA) — IN PROGRESS
The canonical ontology lives in `SocioProphet/ontogenesis` (180 TTL, SHACL shapes, JSON-LD `@context`,
Domains: investigation/fraud/cyber/human/…) and `SocioProphet/prophet-domain-gaia-ontology`
(gaia world-signals: `gaia: <https://schemas.socioprophet.org/gaia/>` — FeatureRegistryEntry, ConcordanceLink,
CanonicalEntity, PromotionState{EvidenceOnly,ReviewRequired,Rejected,Promoted}).
- ✅ `lib/gaia-bridge.ts` — emit Noetica places→FeatureRegistryEntry, entity-resolution→ConcordanceLink,
  concepts→CanonicalEntity as CONFORMANT GAIA JSON-LD with the real namespace; verification→PromotionState;
  SHACL-required-prop conformance check. Endpoint `/api/cap/gaia-export`.
- ☐ Planned: load the actual TTL/SHACL from the repos (vendored) and run full SHACL validation (not just
  required-prop lite); emit ProphetArtifact envelopes (provenance/policy/evidence) like
  `examples/prophet-artifact-gaia-bounded-osm-ingest.example.jsonld`; map our OFIF/geo ingest to the
  `gaia-osm-ingest` artifact actions (fetch/validate) + promotion gate `gaia_ingest_gate`.
- ☐ Planned: contribute Noetica's IOES mappings UPSTREAM (PR into ontogenesis Domains or regis-entity-graph).

## B. Graph DATABASE (HellGraph) SOTA gaps — vs Neo4j 5 / KuzuDB / Memgraph
HellGraph is AtomSpace-class (in-RAM, addNode/addEdge, SPARQL, no tx/index/planner). Most fixes are in the
HellGraph Rust core (`@socioprophet/hellgraph`), so they're work-plan items for that repo, with Noetica-layer
shims where possible.
1. ☐ **Native HNSW vector index in-store + graph-vector hybrid query** (HIGHEST leverage). Bind `usearch`/
   `hnsw_rs` in the Rust core, key by node id; `queryVectorIndex(vec,k)` → ids → traversal. Unlocks one-query
   GraphRAG. Noetica shim: a TS HNSW over noetica-embed vectors keyed to node ids (interim).
2. ☐ **Full-text (BM25) index** — embed Tantivy in the Rust core (what Memgraph did). Interim: our
   `lib/hybrid-retrieve.ts` BM25 already lands the lexical half.
3. ☐ **WAL persistence + crash recovery** — back the store with RocksDB/redb (Oxigraph's approach).
4. ☐ **ACID + MVCC** (version chains) — also the substrate for time-travel/as-of.
5. ☐ **Secondary/composite + primary-key hash indexes** — O(1) prop lookups vs allNodes-scan.
6. ☐ **Cost-based query planner + statistics**; align the sidecar to **openCypher**.
7. ☐ **Property constraints + schema** — interim: `lib/graph-shapes.ts` (SHACL-lite) validates writes.
8. ☐ **CDC / change-streams** — falls out of the WAL; feeds re-embedding + the audit lane.
Skip (contrary to embedded/sovereign design): sharding/replication, columnar rewrite, ISO-GQL badge.

## C. UI screens — vs Microsoft Foundry / IBM watsonx / Google Vertex
Noetica has chat + graph rail + sandbox + voice, but no AI-ops workbenches.
1. ☐ **Agent-trace viewer** (span tree) — HIGHEST leverage; the loop already emits the events. Substrate for 2/4/6.
2. ☐ **RAG-inspection / retrieval-debug screen** (chunks + scores + citations) — genuine whitespace; fuse with the graph.
3. ☐ **Prompt-engineering workbench** (variables, versions, side-by-side compare).
4. ☐ **Evaluation dashboard** (eval runs, metrics, regression compare) — closes the verifier→selection keystone.
5. ☐ **Model-comparison playground** (race the mesh tiers, local verifier adjudicates).
6. ☐ **Dataset / eval-set manager** (capture failing traces → regression set; `lib/eval-capture.ts` is the backend).
7. ☐ **Guardrail/safety config screen** (over scope-d/kill-switch/PII + `lib/trajectory-monitor.ts`/`egress-hygiene.ts`).
8. ☐ **Knowledge-base / index management** (sources, index health, re-index).

## D. Wiring backlog (the ~52 capability libs → live flows)
best-of-N+abstention→generate loop; rag-trust+injection-classifier+capability-egress→tool path; PPR+hybrid-
retrieve+RRF→retrieval; memory-decay+procedural-memory→`remember`; dreaming→idle job→verify→HellGraph; graph-
proposals accept/reject UI→write-back. (`/api/cap/*` exposes them standalone today; deep wiring is pending.)

## E. AI-UI STANDARDS conformance — "is our work compatible with the AI UI standards?"
"GAI something" = **AG-UI** (Agent-User Interaction Protocol, ag-ui.com; said aloud "ay-gee-you-eye"). The
named standard for agent↔UI. Adopt, ranked:
1. ✅ **AG-UI** STARTED — `lib/ag-ui.ts` (16 typed events + factories + run-builder + SSE + validation);
   `/api/cap/agui-run`, `/api/cap/agui-validate`. TODO: real SSE endpoint + React `@ag-ui/client` on the chat
   surface; `STATE_DELTA` (RFC-6902) for graph-rail/plan shared state. Transport can be local Tauri IPC (no cloud).
2. ☐ **Vercel AI SDK UI message-stream + AI Elements** (vendored shadcn components) — fast path for Studio chat.
3. ☐ **MCP Elicitation** (spec 2025-06-18) — structured human-in-the-loop form mid-tool-call; we're already an MCP
   host (mcpManager + grantCheck) → add `capabilities.elicitation:{}` + a flat-JSON-Schema form renderer.
4. ☐ **MCP Apps / MCP-UI** (SEP-1865) — `ui://` sandboxed-iframe resources; Tauri caveat: iframe `sandbox` WITHOUT
   `allow-same-origin`, no `__TAURI__` IPC leaked to sub-frames, route every UI action through grantCheck.
5. ☐ **Microsoft HAX 18 Guidelines** (G2/G8/G9/G10/G11/G18 — uncertainty, stop, edit/retry, disambiguate
   destructive, "why did I get this", "what changed") + **C2PA** on voice clones (reuse device audit key as the
   on-device signer; EU AI Act Art.50 Aug-2026). We have `lib/content-credentials.ts` for the text/marker half.

## F. WHERE WE SUCK (honest self-assessment) + fix plan
1. **~52 capability libs are built + tested but UNWIRED into real flows** — they live at `/api/cap/*` standalone,
   not in the generate/retrieval/memory/tool loop. Biggest gap between "implemented" and "felt". FIX: the
   wiring backlog (D) — one verified slice per rebuild.
2. **No live runtime verification this session** — everything is typecheck+unit-test green but unproven on the
   running app (we build between rebuild windows). FIX: rebuild + smoke-test `/api/cap/*`, HellGraph writes,
   Studio render, AG-UI run.
3. **UI is thin vs MS/IBM** — only 1 of 8 AI-ops screens built (Studio). Missing: RAG-inspect, trace viewer,
   eval dashboard, dataset mgr, guardrail config, KB mgmt. FIX: build one wired screen per turn (Studio pattern).
4. **HellGraph is AtomSpace-class** — no native vector index (shim built, not in-core), no FTS/WAL/MVCC/planner.
   FIX: section B; HNSW + Tantivy first, in the Rust core.
5. **Ontology integration is shallow** — gaia-bridge emits conformant JSON-LD but no full SHACL validation, no
   ProphetArtifact envelopes, nothing contributed UPSTREAM. FIX: section A.
6. **Graph dominated by dev/test exhaust** — analytics run on a hygiene-clean subset, but the store is polluted.
   FIX: constraints/schema (B7) + a real-knowledge re-ingest.
7. **No agent-UI protocol until now** — bespoke streaming. FIX: section E (AG-UI).
8. **No eval→selection loop in production** — we have the verifier + best-of-N + eval-capture libs but they don't
   yet drive live selection or a CI gate. FIX: wire best-of-N into generate (D) + an Eval dashboard (C4).

## G. WHAT PEOPLE WANT (integrate-all priority from PKM/forum sweeps) — see [[noetica-competitive-gaps-2026h1]]
Interactive audio overview, frictionless capture, spaced repetition (lib built), inline link-suggest (lib built),
mind-map (lib built), generative-UI. Plan: surface the already-built study libs (srs/link-suggest/mind-map) in a
Study surface; build capture + audio-overview.
