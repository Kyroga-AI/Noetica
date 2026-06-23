# Noetica — The Next 100 Improvements (fresh audit, post cloud-broker/swarm/keychain)

Four parallel code audits against the *current* tree (after this session's ~40 PRs). Categorized: **WIRING** (lib built+tested but not on a live path — cheapest wins), **SECURITY**, **PRODUCT**, **ENABLING** (infra/packaging), **QUALITY** (correctness/UX polish). Every item is grounded; file:line where the agent verified it.

## The meta-finding
Two themes dominate: **(a) wiring** — 14 frontier libs are *all still dormant* in the live agent loop, and the new cloud/swarm/porter systems each *build a plan/record that nothing executes*; **(b) decorative governance** — the audit-chain, injection-classifier, purpose-binding, and grantCheck are built but don't enforce. Most of the top wins are integration, not R&D.

---

## WIRING (1–22) — built, not connected (cheapest leverage)
The 14 dormant libs (all small pure fns, "just wire it"):
1. Wire `hybrid-retrieve` (bm25+fuseHybrid) into `retrieval.ts` fusion — lexical BM25 joins dense+PPR (cap-only today).
2. Wire `late-interaction` (`rerankLate`, ColBERT) as a final rerank stage after fusion (0 importers).
3. Wire `best-of-n` (`selectBestOfN`+`shouldStop`) into the critic (server.ts:3279) for agreement early-stop.
4. Wire `self-consistency` (`majorityVote`) as the critic tie-break (cap-only).
5. Wire `eval-capture` (`captureFailure`/`dedupeCases`) post-loop → auto-grow an eval set from failed turns (0 importers; **the verifier→selection keystone**).
6. Wire `procedural-memory` (`retrieveSkills`/`distillSkill`) so successful tool sequences become reusable skills.
7. Wire `constrained-decode`/`validateToolCall` as the pre-execute tool-arg gate (server.ts:3432).
8. Wire `multi-agent` (`decompose`/`aggregate`) into the inline `dispatch_agent` fan-out (server.ts:1308).
9. Wire `lazy-graphrag` (`lazySubgraph`) + `think-on-graph` (`beamTraverse`) for query-time subgraph expansion.
10. Wire `planner-executor` (`shouldReplan`) as the loop's stall/replan controller.
11. Wire `plan-mode` as a pre-execution approval gate (also EU-AI-Act human-oversight).
12. Wire `council` (`councilVote`) into a live `/api/cap/` case or the critic (script-only today).
13. **dispatch_agent → swarm**: `sub-agent.ts` has zero references to swarm-volume/blackboard — the swarm substrate is unreachable from the one thing that should use it. (Partially done at the `executeTool` layer; push it into `runSubAgent`.)
14. **broker → provision → porter**: `planPorterDeploy` brokers a SKU + sets env but never calls `provisionInstance`, so a Porter deploy targets a box that doesn't exist (porter-paas.ts:56).
15. Wire `audit-chain` (Ed25519 hash-chain) into `emitScopedTelemetry` — today it writes unsigned, unchained JSONL (audit-chain.ts is dead code).
16. Wire `injection-classifier` (`isLikelyInjection`) onto live `latestUserContent` + tool-result text (debug-endpoint-only today).
17. Wire `assertCapability('exec'/'fs-write'/'net')` into each tool handler — purpose-binding has **zero call sites** (agent-containment.ts:95); a read-only purpose can still shell out.
18. Make `grantCheck` actually deny — hardcodes `valid:true` (a2a/grantCheck.ts:57); look up grant/revocation/expiry before dispatch.
19. trajectory-monitor alerts only `sse('safety')`+warn — make a high-severity alert **arm the kill-switch / refuse the next sensitive tool** (server.ts:2618).
20. **Gitea ingest button** — `ingestRepo()` hardcodes `provider:'github'` (CodeSurface.tsx:392); backend supports Gitea symmetrically. Smallest high-value wire.
21. **Auto-alignment + entity-resolution on ingest** — `/api/graph/ingest` is a plain write; never calls resolve/align. Wire alignment + `resolveEntities` into ingest.
22. **Command palette runs capabilities** — palette only navigates; add a "run `/api/cap/*`" action kind (CommandPalette.tsx:62).

## SECURITY (23–46)
23. **(H) Anchor the attested lane** — `security_attested` is a raw client boolean (server.ts:2318); any caller arms the offensive-security/abliterated models. Require a device-key-signed attestation token (#86).
24. **(H) execute sandbox env leak** — `app/api/execute` Python `spawn('python3',['-c',code])` inherits full `process.env` (route.ts:145) → leaks secrets to executed code. Strip env to an allowlist.
25. **(H) execute `vm` is not a sandbox** — JS runs in Node `vm` (route.ts:98), escapable. Use isolated-vm / a real jail, or remove in favor of the sidecar run_command sandbox.
26. **(H) No inbound rate limiting anywhere** — /api/chat, /api/tool, /api/cap/*, /api/oauth all unthrottled → local DoS / cost-amplification. Add a per-route token-bucket.
27. **(H) OAuth proxy CSRF + token-in-body** — oauth-token-routes.ts:64 has no Origin/CSRF guard and returns the provider access_token in the body to any localhost page. Add the guard + verify PKCE/state.
28. **(H) requireApiToken off by default + only 3 routes** — /api/containment(disarm!), /api/tool, /api/cap, /api/repo/ingest, /api/memory/forget, /api/import/chats have no token. Default-generate a token on first boot + apply to all mutating routes.
29. **(M) Kill-switch disarm needs auth, not just CSRF** — /api/containment disarm is the top safety control; gate it behind requireApiToken / operator confirmation (server.ts:4118).
30. **(H) scope-d defaults to allow-all** when `SCOPED_ENGAGEMENT_POLICY` unset (scope-d.ts:104/154) — the egress gate + capability confinement are no-ops in every default install. Ship a fail-closed default policy.
31. **(M) scope-d always-emit telemetry** — `emitScopedTelemetry` early-returns when no policy configured (scope-d.ts:189); write the local audit chain regardless so governance evidence always exists.
32. **(M) scope-d local-route bypass** — `checkEgress` allows any `provider==='ollama'` regardless of target; a remote Ollama-compatible baseUrl egresses unchecked. Require the resolved host be loopback.
33. **(M) purpose fallback is fail-OPEN** — `resolvePurpose` defaults unknown→`full` (agent-containment.ts:47). Default to read-only/research.
34. **(M) No max-body cap on /api/chat + /api/tool** — unbounded `body += chunk` (server.ts:5626/4336); /api/cap caps at 8MB but the hot routes don't.
35. **(M) No schema validation** — `JSON.parse(body) as ChatRequest` raw cast (server.ts:5631); no runtime checks on messages/tools/model_id. Add per-route schemas.
36. **(M) per-/api/cap input schemas** — most handlers do `b.x as T` with no validation; proto-pollution guard only covers Map routes.
37. **(M) provision `sh -c` injection surface** — `executeProvision` shells `sh -c rec.createCommand` (cloud-provision.ts:129); use execFile with arg arrays before any request-derived SKU/region flows in.
38. **(M) Encryption at rest** — ~/.noetica sessions/governance/identity/memoryd/events.jsonl are cleartext (secrets moved to keychain, but history/memory/audit aren't). Encrypt with a keychain-held data key.
39. **(L) Restrictive file modes** — most ~/.noetica writes use default umask; enforce 0700 dirs / 0600 files.
40. **(M) Broker placement isn't scope-d-gated** — header claims it; `brokerCompute`/`toAgentplanePlacement` never call checkEgress (cloud-broker.ts:9). Gate the cloud target choice, not just post-provision.
41. **(M) writeSecurityState off the same boolean** — Tor/SourceOS signal flips on the unauthenticated `security_attested` (server.ts:2357); gate behind #23.
42. **(M) Blackboard has no size cap** — `writeBlackboard` writes arbitrary JSON, `sizeGiB` unenforced on directory volumes (swarm-volume.ts:122) → disk-fill.
43. **(M) Swarm manifest race** — join/leave do read-modify-write with last-writer-wins (swarm-volume.ts:98); concurrent dispatch drops members. Add a lock/single-flight.
44. **(L) /api/graph/ingest is the open audit sink** — grantCheck emits to it with no auth (server.ts:5388); route audit through the signed chain instead.
45. **(L) execute session/tmp dirs never reaped** (route.ts:17) — TTL-clean them.
46. **(M) Tool args validated for syntax only** — `repairToolArgs` fixes JSON, not correctness; bad args execute-and-fail instead of re-prompting (server.ts:3432).

## PRODUCT (47–70)
47. **Prophet Workspace — real IMAP sync** (config exists, nothing reads it; MailPanel STUB_THREADS=[]).
48. **Prophet Workspace — real SMTP send** (compose is disabled; no nodemailer).
49. **Prophet Workspace — real CalDAV** (calCaldavUrl unused; calendar only works via Google).
50. **No-code agent builder** — author name+prompt+tools+model (agents are 5 hardcoded archetypes). Widest product gap.
51. **Connector/MCP marketplace** — curated browsable catalogue (manual add-form only today).
52. **KB round-trip import** — export exists, no `/api/graph/import` for GraphML/JSON.
53. **Fleet/swarm status panel** — live agent roster + per-instance state + teardown (only provisioning copy today).
54. **Feedback loop (👍/👎/correct)** on AI output — blocks the verifier→selection signal (MessageBubble has no rating).
55. **Alignment vs graph atoms + beliefs** — align-check only uses doc chunks; structured-knowledge contradictions are invisible.
56. **Alignment drill-through** — click a conflicting claim → open the source doc/atom (snippet-only today).
57. **Multi-GPU SKUs** in the broker catalogue — any `count>1` returns zero quotes today.
58. **Quota/capacity awareness** — broker picks cheapest with no stock-out check → dead placements.
59. **Spot-eviction risk** — spot treated as free savings; add eviction-rate penalty to ranking.
60. **Broker teardown lifecycle** — `teardownCommand` is generated but never executed; boxes leak + bill.
61. **Instance health/state polling** — state flips to `ready` when the CLI returns, not when the box booted/joined.
62. **SSH key management** — `sshRef` hardcoded `@pending`; provisioned boxes are unreachable for agentplane.
63. **Porter actually deploys** — `planPorterDeploy` computes commands but never spawns the porter CLI.
64. **Replace raw-JSON capability Lab** with typed per-capability forms/cards.
65. **First-run onboarding** beyond model setup — a brief tour of the grouped nav + connectors.
66. **Repo ingest: code-aware chunking** (today generic text chunker over source).
67. **Swarm parallel-aggregate primitive** — a fan-in helper to await/aggregate N agent partials (readBlackboard is sequential).
68. **Swarm GC** — reap all-stale swarms' volumes/LVs (unbounded disk today).
69. **Broker egress/min-runtime costs** in the quote — `totalUsd` is perHour×hours only; savings headline is overstated.
70. **Live-pricing per-region cache** — `_cache` ignores the region arg → cross-region quotes serve wrong data.

## ENABLING (71–90) — infra/packaging
71. **AWS Price List adapter** (cloud-pricing) — only Azure is live; 3/4 clouds rank on static prices.
72. **GCP Cloud Billing Catalog adapter.**
73. **IBM pricing adapter.**
74. **Linux release functional** — first-boot provisioning is darwin-only (managed-runtime/managed-ollama return null off-darwin); seatbelt `sandbox-exec` is macOS-only; deploy.sh is darwin-only.
75. **Running-bundle smoke test** — nothing installs the artifact + checks it boots (#97).
76. **macOS notarization + staple** — ships unsigned (signingIdentity null); release notes ship the quarantine workaround.
77. **Tauri auto-updater** — no updater plugin; updates are brew-only (macOS), nothing on Linux.
78. **Bundle sovereign voice** (whisper/ffmpeg/XTTS) — none in externalBin; STT shells to host binaries (#48/49).
79. **Native wake-word** — replace the dead WKWebView SpeechRecognition with Porcupine/openWakeWord.
80. **ANN/HNSW index** — vector-index is O(n) brute force; add usearch/hnsw_rs in the Rust core.
81. **Embedder unification** — BGE-small 384 vs nomic 768 vs prime-topics 22 dims; unify the live RAG space + stamp {model,dim}.
82. **OAuth bundled client IDs + `noetica://` redirect handler** — connectors are BYO-app + redirect rejected → dead on desktop.
83. **Move OAuth token-exchange fully to the sidecar** — Next routes don't ship in the static export (mostly done; finish + verify).
84. **Thread AbortSignal** through streamAnthropic/OpenAI/Ollama + executeToolWithTimeout — prerequisite for disconnect-abort.
85. **Unify the 3 copy-pasted provider tool loops** into one adapter-driven loop — the enabling refactor for most quality fixes.
86. **Persistence sinks** for eval-capture + procedural-memory (they return values with no store).
87. **Linux arm64 build** (currently x64-only) + AppImage (ci/appimage.sh is dead).
88. **Real cloud-provision exec path tested** — cloud-init hardcodes `CONTROL_PLANE:8080` placeholder, never substituted with a reachable address.
89. **AWS teardown uses instance-id not Name tag** — guaranteed to fail once teardown is wired.
90. **Single rerank seam in retrieval.ts** so BM25/late-interaction/subgraph plug into one place (enables #1/#2/#9).

## QUALITY (91–100) — correctness/UX
91. **Divergence recovery only on the Ollama path** — Anthropic/OpenAI loops have no stuck-loop detection (server.ts:3522/3619).
92. **MAX_TURNS silent exhaustion** — loops fall through with partial content, no "hit the turn limit" signal.
93. **No AbortController on client disconnect** — `res.on('close')` checkpoints but doesn't cancel the stream → compute keeps burning (server.ts:2635).
94. **`isModelAvailable` prefix-match bug** — `llama3:8b` spuriously matches `llama3.1:70b` (router.ts:492); compare the base segment.
95. **Prompt caching is Anthropic-only** — OpenAI/OpenRouter/HF pay full prefix cost every turn; add their cache hints.
96. **Critic gated to no-tools turns** — the whole deliberation layer is dark for any tool-bearing or cloud turn (server.ts:3279).
97. **Alignment entailment polarity false-positives** — opposite-negation parity mis-scores; upgrade to a cross-encoder NLI.
98. **Alignment jaccard fallback** over-fires on stopwords — at least TF-IDF/n-gram weight it.
99. **Global error boundary** — a render throw white-screens the app (no app/error.tsx).
100. **Backend-unreachable banner + cross-surface deep-linking + a11y aria-labels** (424 buttons / 25 labels) — the "feels broken/disconnected" cluster.

---

## How to attack it (sequencing)
1. **Wiring sprint** (1–22) after the **3-loop unification (#85)** — closes the most competitive gaps at integration cost; #5 (eval-capture) + #54 (feedback) together close the verifier→selection keystone.
2. **Security activation** (23–46) — #23 attestation, #24/25 sandbox, #26 rate-limit, #28 tokens, #30 scope-d fail-closed, #15 audit-chain are the load-bearing ones; most are activating built machinery.
3. **Broker→real** (71–73 pricing, 60/61/62 teardown/health/ssh, 14 broker→porter→provision) — finishes the cloud-C2 stack.
4. **Product surfaces** (47–53) — Prophet Workspace backends, agent builder, MCP marketplace, fleet panel.
5. **Ship-blockers** (76 notarize, 75 smoke test, 82 OAuth, 77 updater) before any real distribution.
