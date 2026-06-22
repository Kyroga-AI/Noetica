# Noetica — 111 Gaps & Improvement Areas (grounded audit, 2026-06-22)

Eight parallel code audits across the product. Every item cites real evidence (file:line). Severity: **H** high / **M** medium / **L** low. This supersedes ad-hoc gap notes; pull from it for sprints.

## Cross-cutting themes (read first)
1. **Built-but-not-wired.** A huge amount of frontier machinery exists and is *tested* but never called on the live path: RAG injection defense (`rag-trust`), memory decay, HippoRAG (`graph-ppr`), LazyGraphRAG, think-on-graph, the signed audit-chain, purpose-binding, grantCheck enforcement, injection/egress classifiers. The single highest-leverage program is **wiring these into the live paths**, not building more.
2. **macOS-shaped, Linux-primary.** Signing, seatbelt sandbox, `say`, screencapture, runtime provisioning, and CI are all macOS-only — yet Linux is the stated future-primary target. The Linux bundle currently fails to build *and* would boot non-functional.
3. **Display-layer vs store-layer.** Graph dedup, categorization, clean-filtering, lexical-merge are all redone on every read instead of enforced once at write — and the graph is ~84% dev/test exhaust.
4. **Sovereignty machinery is decorative by default.** scope-d audit/enforcement ships OFF; kill-switch covers one route; secrets in plaintext localStorage; the "attested" lane arms on a client boolean.
5. **Islands, not a product.** Surfaces don't deep-link or cross-navigate; capabilities are raw JSON consoles; silent `catch{}` everywhere hides backend-down.

---

## A. Chat / agent loop / model routing (1–16)
1. **(H)** `isModelAvailable` prefix-matches variants — `qwen2.5:7b` reports present when only `qwen2.5:14b` is installed (`router.ts:490`). Fix: match full `name:tag`.
2. **(H)** Client disconnect never aborts in-flight generation — `streamOllama`/loops take no AbortSignal; `res.on('close')` only checkpoints (`server.ts:2503,3181`). Model keeps burning to MAX_TURNS. Fix: thread AbortController.
3. **(M)** MAX_TURNS exhaustion ends silently mid-tool-call — loops break only on no-tool-calls; ships partial content, no "hit limit" notice (`server.ts:3175`). Fix: final no-tools completion + marker.
4. **(M)** Divergence/repeat-tool recovery exists only on the Ollama path, not Anthropic/OpenAI (`server.ts:3226`). Fix: shared helper.
5. **(M)** Three near-identical 100-line tool loops copy-pasted per provider and drifting (`server.ts:3175/3313/3413`). Fix: unify behind an adapter.
6. **(M)** Provider error bodies forwarded verbatim to UI + stored unredacted (`server.ts:1804,3717`). Fix: map to generic; redact server-side.
7. **(M)** `NOETICA_CAPABILITY_ROUTING` flag is dead — escalation runs unconditionally (`server.ts:2257`). Fix: actually gate on the flag.
8. **(M)** Capability-escalation hardcodes cloud model ids, silently no-ops without a key, never tries a *larger local* model (`server.ts:2260`). Fix: local-upgrade rung first.
9. **(M)** Bandit reward recorded against the bandit's pick, but responsive/escalation overwrite `model` afterward (`server.ts:2272,2359`). Fix: reward the final model.
10. **(M)** `classifyTask` is first-match keyword regex; generic words (`test/build/api`) make "coding" greedily win (`router.ts:90`). Fix: weighted scoring + lean on the embedding intent classifier.
11. **(L)** `resolveToolCapable()` final fallback is a literal `qwen2.5:7b` that bypasses availability (`router.ts:356`). Fix: best *available* tool-capable model.
12. **(L)** Security-lane fallback models hardcoded + assumed installed (`router.ts:144,311`). Fix: gate on availability.
13. **(L)** `narrateEscalation` string-matches free-text reasons + indexes `why[0]!` (`narration.ts:84`). Fix: structured reason enum.
14. **(M)** Zero test coverage for the tool loop, MAX_TURNS, divergence, bandit/escalation ordering. Fix: extract loop → unit tests.
15. **(L)** `MAX_TURNS` env parse swallows malformed input; `=0` silently becomes default (`server.ts:2486`). Fix: explicit parse + warn.
16. **(M)** `run_command` spawns a login shell with full parent env (`-lc`, `{...process.env}`) → secrets reach sandboxed shell; dev≠packaged behavior (`server.ts:1123`). Fix: explicit allowlisted env, drop `-l`.

## B. Graph / GDS / data quality (17–32)
17. **(H)** "Memory" lens (`view=document`) returns ~0 — Document atoms carry only path-shaped `filename`, stripped to null by `cleanLabel` before BFS (`graph-surface.ts:84,127`; `doc-store.ts:163`). Fix: clean `title` at ingest or special-case Document basenames.
18. **(M)** Lens label↔param mismatch: "Memory"→`document` selects uploaded-file projections, not memory atoms (`GraphRailPanel.tsx:21`). Fix: point at memory atoms or rename.
19. **(M)** Graph is ~84% `LearningState` self-state exhaust written every 60s + every turn into the knowledge store (`server.ts:6854,6970`). Fix: separate self-state namespace.
20. **(M)** `categoryFor` is a brittle substring re-bucketing of `labels[0]` at render time (`graph-surface.ts:48`). Fix: store category at ingest from the real atom type.
21. **(M)** Writeback auto-creates missing endpoints as `Concept` with the raw id as label (`graph-writeback.ts:50`). Fix: require real kind; don't auto-create.
22. **(M)** No scheduled graph maintenance — hygiene `apply` is manual endpoint only; junk accretes forever (`server.ts:6539`). Fix: scheduled, audited compaction.
23. **(M)** No node/edge decay/TTL — store is append-only; stale docs/sessions/snapshots never age out (`graph-writeback.ts:1`). Fix: age/usage decay → archive.
24. **(M)** Analytics cache signature is just `nodeCount:edgeCount` — serves stale PageRank/Louvain when content changes without count change (`server.ts:212`). Fix: content hash + bust on writeback.
25. **(M)** Analytics/PageRank/Louvain run over the exhaust-polluted set (loose `cleanLabel!=null` filter), so "importance"/communities reflect junk (`server.ts:210`). Fix: positive allowlist of knowledge classes.
26. **(L)** The clean-set predicate is copy-pasted ~16× across server.ts + surface (`server.ts:210,4180,…`). Fix: one `isCleanNode()` helper.
27. **(L)** Approximated betweenness linearly scaled from a stride sample → non-comparable magnitudes, but UI ring threshold applies regardless (`graph-analytics.ts:235`; `SurfaceGraph.tsx:304`). Fix: proper estimator + surface approximation.
28. **(M)** Louvain has no resolution control/singleton handling on a junk-heavy graph → mega-communities of exhaust become "themes" (`graph-analytics.ts:166`). Fix: de-exhaust + resolution knob.
29. **(L)** Edge dedup only at display layer; store accumulates near-dupes every reader must re-dedup (`graph-surface.ts:228`; `graph-writeback.ts:49`). Fix: canonical-relation dedup at write.
30. **(M)** Lexical node-merge (`notca/ntca`) is display-only; store keeps all dupes, never converges (`graph-surface.ts:193`). Fix: promote to hygiene mergeActions on the store.
31. **(M)** GAIA ontology is a read-time overlay never written into the graph; "abandonment is a state" invariant unmaterialized (`gaia-ontology.ts:46`). Fix: emit GAIA kinds at ingest/projection.
32. **(M)** Degree-0 dropping hides freshly-ingested valid concepts while junk orphans persist; orphan attachment only runs in manual hygiene at sim≥0.8 (`graph-surface.ts:162`; `graph-hygiene.ts:166`). Fix: auto-attach new nodes post-ingest.

## C. RAG / memory / retrieval / embeddings (33–46)
33. **(H)** Three incompatible embedding spaces (Ollama nomic 768, OpenAI 512, the `noetica-embed` sidecar bge-small 384) — cross-store cosine is meaningless; our own sidecar is barely used (`ollama.ts:107`; `route.ts:51`; `embed-sidecar/src/main.rs:26`; `retrieval.ts:233`). Fix: unify on the sidecar; stamp `{model,dim}`.
34. **(H)** No ANN/HNSW index — every search is an O(N) scan + full sort (`vector-index.ts:34`; `doc-store.ts:201`; `retrieval.ts:405`). Fix: real ANN in the Rust core/sidecar.
35. **(H)** `VectorIndex` is stateless, rebuilt per request from the body, no persistence/delete (`capability-routes.ts:181`; `vector-index.ts:21`). Fix: durable, mutable, incremental upsert.
36. **(H)** The indirect-injection defense (`rag-trust` sanitize/applyTrust) is built but never called — live RAG injects raw chunk text (`server.ts:2603`; `rag-trust.ts:58`). Fix: sanitize+down-weight before injection.
37. **(H)** Memory decay/forgetting (`memory-decay.ts` full Ebbinghaus model) has zero callers; memory evicts by insertion order at 500 (`adapter.ts:62`). Fix: wire `pruneToBudget`/`touch`.
38. **(M)** No reranker model — "rerank" is RRF + term-overlap heuristic only (`rag-rerank.ts:55`). Fix: optional local cross-encoder (bge-reranker via sidecar).
39. **(M)** Retrieval never evaluated online — eval metrics exist but need hand-supplied labels (`rag-eval.ts:8`; `capability-routes.ts:121`). Fix: golden set + per-turn trace logging.
40. **(M)** HippoRAG personalized-PageRank built but disconnected from retrieval (`graph-ppr.ts:76`). Fix: PPR seed-expansion retrieval pattern.
41. **(M)** LazyGraphRAG, think-on-graph, hybridGraphVector are dead code; only the heavy pre-built-report GraphRAG is wired (`lazy-graphrag.ts:13`; `server.ts:6346`). Fix: route global-search through lazy, or delete.
42. **(M)** Fixed char-window chunking (1100/150), structure-blind, splits tables mid-row (`doc-store.ts:52`). Fix: token-aware structural chunker.
43. **(M)** Context assembly budgets by `len/4` chars and bisects the last chunk mid-text; doc-RAG + retrieve() budgets not unified (`retrieval.ts:79,210`). Fix: real tokenizer + chunk-boundary truncation.
44. **(M)** Graph/memory recall has no citable provenance ids; `hellgraphRecall` hardcodes `score:0.85` + one synthetic id (`adapter.ts:182`; `retrieval.ts:257`). Fix: carry stable source ids through every pattern.
45. **(M)** Similarity thresholds/scores are uncalibrated magic numbers across patterns, then cross-ranked as if comparable (`retrieval.ts:617,318`; `graph-rag.ts:86`). Fix: calibrate to a common scale.
46. **(M)** Embedding model hardcoded per call site; no registry, no `{model,dim}` stamp, no migration — switching the model silently corrupts the index (`ollama.ts:107`; `main.rs:26`). Fix: central config + versioned vectors.

## D. Voice / multimodal (47–60)
47. **(H)** Default TTS provider is `openai` (needs a paid cloud key) on a local-first product; silent fallthrough to `say` (`defaults.ts:45`; `useVoice.ts:237`). Fix: default to cloned/system + first-run nudge.
48. **(H)** whisper-cli + ffmpeg not bundled/auto-installed; STT dead until manual `brew install`; `provision-runtime.ts` omits them (`stt.ts:26`). Fix: bundle whisper.cpp + ggml + ffmpeg. **(chosen build)**
49. **(H)** XTTS voice-clone venv only created by manually running `provision-voice.sh`, which nothing in the build invokes (`voice-runtime.ts:94`). Fix: auto-provision at first boot. **(chosen build)**
50. **(H)** Wake-word + WebSpeech STT/TTS are dead in the Tauri WKWebView/WebKitGTK (no `webkitSpeechRecognition`) — the shipped "hey noetica" toggle is a no-op (`useVoice.ts:131`). Fix: native wake-word (openWakeWord/Porcupine) → local whisper.
51. **(H)** `say` TTS tier is macOS-only, unguarded — silent no audio on Linux/Windows (`main.rs:154`; `useVoice.ts:250`). Fix: platform-branch (espeak-ng/spd-say/Piper).
52. **(H)** OCR is macOS-Vision-only (Swift compiled at runtime with `swiftc`) — dead on Linux/Windows + macOS w/o Xcode CLT (`ocr.ts:17`). Fix: tesseract/PaddleOCR fallback, bundled.
53. **(M)** No streaming TTS — whole reply synthesized before any audio plays; multi-second latency (`useVoice.ts:184`; `server.ts:5329`). Fix: chunked/sentence-pipelined playback.
54. **(M)** XTTS CPU/MPS latency unbounded + unsurfaced; flagship local voice can feel broken (`voice-runtime.ts:37`). Fix: warm on provision, progress state, Piper fast path.
55. **(M)** STT availability probed (`/api/stt/status`) but UI never gates — user records a whole utterance before learning STT is missing (`useVoice.ts:82`). Fix: check on mount, disable mic.
56. **(M)** Whisper model hardcoded `base.en` (English-only) despite a `voiceLanguage` setting; STT/TTS disagree on language (`stt.ts:17`). Fix: pick ggml by language.
57. **(M)** Realtime voice is 100% OpenAI cloud, no local realtime path — contradicts sovereignty (`useRealtimeVoice.ts:12`). Fix: local VAD→whisper→model→TTS live mode.
58. **(M)** Realtime client uses deprecated `ScriptProcessorNode` + ships the API key from the renderer as a WS subprotocol; pins a dated model (`useRealtimeVoice.ts:98,133`). Fix: AudioWorklet + proxy through sidecar.
59. **(M)** Image understanding needs a manually-pulled VLM; multimodal silently degrades to "I can't see the image" (`server.ts:2226`). Fix: one-click/auto VLM pull.
60. **(M)** No screen-capture multimodal input path into OCR/vision (`/api/graph/from-image` takes an existing path only) (`server.ts:5250`). Fix: Tauri capture → temp PNG → OCR/vision.

## E. UI / UX / surfaces (61–76)
61. **(H)** No deep-linking/URL state — `activeSurface` is React state only; nothing is addressable or survives reload (`AppShell.tsx:129`). Fix: mirror surface+entity into `location.hash`.
62. **(H)** Surfaces are islands — only CodeSurface has cross-surface nav; graph node/RAG chunk/artifact can't jump anywhere (`surfaces/*`). Fix: shared `navigate(surface,params)`.
63. **(H)** No global "backend unreachable" banner or ErrorBoundary anywhere; sidecar-down degrades every surface silently (`AppShell.tsx:308`). Fix: health poll + banner + boundary.
64. **(H)** Graph rail swallows backend errors in **14** `catch{/*offline*/}` blocks; only one sets error (`GraphRailPanel.tsx:70…`). Fix: one panel-level unreachable+retry state.
65. **(H)** `RelatedPanel` is a hardcoded stub (all counts 0) with no loading/empty distinction — always looks broken (`RelatedPanel.tsx:18`). Fix: wire or explicit empty state.
66. **(H)** SourceOS/Evidence rail action buttons are dead (no onClick): Open graph explorer, event ledger, replay, export (`SourceOSRailPanel.tsx:79`). Fix: wire or remove.
67. **(H)** "Capabilities Lab" is a JSON-in/JSON-out console, not UX — real backend powers with no first-class surface (`LabSurface.tsx:41`). Fix: promote high-value caps to purpose-built panels.
68. **(H)** CodeSurface "Add repository"/"Configure webhook receiver" buttons are dead (`CodeSurface.tsx:191`). Fix: implement or hide.
69. **(M)** Fetch shim doesn't handle `URL`-object inputs + swallows its own misses silently (`app/layout.tsx:23`). Fix: add URL branch + dev warn on miss.
70. **(M)** RAG Inspector + Lab have no empty/no-results state distinct from pre-run; errors land in the result `<pre>` (`RagInspectSurface.tsx:26`; `LabSurface.tsx:54`). Fix: distinct empty/error states.
71. **(M)** Long ops have no cancel — model pull (8GB strands the user) + Tune caching (`ModelsPanel.tsx:187`; `TuneSurface.tsx:88`). Fix: AbortController-backed cancel.
72. **(M)** No feedback loop (thumbs/correct/rate) on any AI output — the verifier→selection keystone has no capture surface (`CoworkSurface.tsx:465`). Fix: reusable rating affordance.
73. **(M)** "Test voice" exhausts its fallback chain silently — no failure feedback (`VoicePanel.tsx:135`). Fix: surface "voice test failed".
74. **(M)** Inconsistent/near-invisible error styling (errors in muted tertiary text); no shared error component (`FeatureFlagsSection.tsx:45`). Fix: one `<InlineError>`.
75. **(M)** 416 buttons, 24 aria-labels; icon-only controls unlabeled; palette lacks combobox/listbox ARIA (`Topbar.tsx:58`; `CommandPalette.tsx:104`). Fix: a11y sweep + roles + key hint.
76. **(M)** Mobile/responsive effectively absent — 16/all component files use breakpoints; 3-column shell has no narrow collapse (`AppShell.tsx`). Fix: responsive shell (matters for Linux/portability).

## F. Security / sovereignty / governance (77–90)
77. **(H)** scope-d egress/action gating + audit is a **no-op by default** — unset `SCOPED_ENGAGEMENT_POLICY` → allow-all, zero audit records (`scope-d.ts:67,189`). Fix: ship a fail-closed default policy / always emit telemetry.
78. **(H)** Purpose-binding (`assertCapability`/`permits`) has **zero call sites**; session purpose is permanently `full` (`agent-containment.ts:95`; `server.ts:1311`). Fix: bind purpose from request + gate tool dispatch.
79. **(H)** Kill-switch checked only on `/api/chat`; `/api/cap/*`, `/api/oauth/*`, code-solve ignore it (`server.ts:5292`). Fix: centralize the check before any mutating/model/egress route.
80. **(H)** Provider API keys stored plaintext in localStorage, shipped per-request (`context.tsx:40`; `types.ts:25`). Fix: OS keychain (tauri-plugin-stronghold/keyring), never localStorage for secrets.
81. **(H)** Connector OAuth access+refresh tokens stored plaintext in localStorage (`auth/storage.ts:16`). Fix: keychain; one XSS currently yields every account.
82. **(H)** Most mutating routes have no auth; the bearer-token gate is wired to only 3 routes; `/api/containment` (arm/disarm/bind) has neither CSRF nor token — a local page can disarm containment (`server.ts:1040,3846`). Fix: uniform CSRF + token on state-changing routes.
83. **(M)** CSRF guard is allowlist-based — new mutating `/api/cap/*` routes are unprotected by default (`capability-routes.ts:46`). Fix: guard all POSTs, allowlist the safe reads.
84. **(H)** The Ed25519 signed audit-chain (Phase 3a) is built but not wired; live audit is unsigned, unchained, locally editable JSONL (`scope-d.ts:210`; `audit-chain.ts:84`). Fix: route telemetry through the hash-chain + device-key signature.
85. **(M)** MCP `grantCheck` hardcodes `valid:true` — audits but never denies; not even called in `callTool` (`grantCheck.ts:56`; `mcp/client.ts:250`). Fix: real enforcement gating dispatch.
86. **(H)** The attested "uncensored" lane arms on a client-supplied boolean — no device-key/credential/policy anchor; CSRF can flip it (`server.ts:720,2212`). Fix: bind arming to device key / scope-d authority + token.
87. **(M)** No inbound rate limiting on chat/inference/OAuth/cap routes — a local page can exhaust the GPU or relay credential-stuffing through the OAuth proxy (`server.ts`). Fix: per-route token bucket.
88. **(M)** No encryption at rest for `~/.noetica` (audit log, containment state, memory, tokens, blobs) — laptop theft = full disclosure (`scope-d.ts:211`). Fix: keychain-sealed envelope encryption.
89. **(M)** Persistence-race hardening covered only CMS+swarm; containment + security-state + 5 other atomic writers still race — a torn `saveContainment` undermines the fail-closed kill-switch (`server.ts:252,267`). Fix: extend single-flight+unique-tmp.
90. **(H)** Egress gate derives `target` from a fixed provider→host map, so a custom `baseUrl` (now OpenRouter/HF) egresses to a host scope-d never sees → authorizedTargets bypass; injection/exfil classifiers only in debug endpoints (`server.ts:2300`; `capability-routes.ts:127`). Fix: derive target from the resolved URL; wire classifiers into the live path.

## G. Packaging / release / cross-platform (91–103)
91. **(H)** release-linux fails — noetica-embed sidecar never built for Linux, but it's an injected externalBin (`release.yml:230`; `inject-am-sidecar-config.mjs:25`). Fix: add the Linux `cargo build` target step (mirror the macOS fix).
92. **(H)** First-boot runtime provisioning is darwin-only — Linux ships with no inference runtime (`managed-runtime.ts:54`; `managed-ollama.ts:85`). Fix: generalize provisioning to Linux.
93. **(H)** Managed-runtime launch hardcodes macOS `sandbox-exec` (seatbelt) — nonexistent on Linux (`managed-ollama.ts:106`). Fix: bwrap/firejail/systemd on Linux.
94. **(H)** No code signing/notarization — ships unsigned, Gatekeeper-blocked; validation *enforces* the placeholders (`tauri.conf.json:44`; `validate-packaging-metadata.mjs:85`). Fix: Developer-ID sign + notarytool staple.
95. **(H)** No Tauri auto-updater at all — no in-app updates, no rollback, brew-only (`grep`: no updater plugin). Fix: tauri-plugin-updater + signed `latest.json`, or document brew-only + harden.
96. **(H)** `validate.yml` has no Linux Tauri build — Linux breakage invisible until tag-push (which is why #91 shipped broken) (`validate.yml:80`). Fix: add a `tauri-linux` validate job.
97. **(H)** No integration/smoke test on a *running* built bundle — `smoke-standalone.mjs` hits a dev server only; bundles can ship dead and pass CI (the 9MB-dead-DMG class) (`smoke-standalone.mjs:3`). Fix: post-build job that launches the bundle + asserts the port.
98. **(M)** Sidecar runner staging is "best-effort, never fatal" + Ollama version/format hard-pinned (already broke once) (`download-sidecars.sh:77`). Fix: per-platform completeness gate + checksum pin.
99. **(M)** Linux arm64 entirely unbuilt despite triple plumbing implying support (`package.json:39`; `release.yml:241`). Fix: arm64 matrix leg or drop the plumbing.
100. **(M)** Production icons are *enforced placeholders* — CI passes because the icon literally says "Replace before production" (`validate-packaging-metadata.mjs:138`). Fix: real raster/.icns + gate tagged releases.
101. **(M)** update-cask rewrites the cask via global `sed` and pushes straight to `main` with no `brew audit`/rollback; tap update is continue-on-error (`release.yml:307`). Fix: anchored replace + audit + PR/rollback.
102. **(M)** Computer-use + screencapture are macOS-gated; static-export→Linux-bundle path never validated on a real Linux build (`main.rs:206,352`). Fix: Linux capture (grim/scrot) + ydotool; validate in CI.
103. **(L)** macOS unguarded `say`/`killall say` in Rust will spawn-error on Linux (dup of #51 at the Rust layer) (`main.rs:153`). Fix: cfg-gate.

## H. Integrations / connectors (104–111)
104. **(H)** No bundled OAuth client IDs — every provider is "BYO-OAuth-app," dead on first launch for normal users (`ConnectionsPanel.tsx:132,561`). Fix: register first-party apps, bundle public client IDs.
105. **(H)** OAuth redirect URI is `${origin}/oauth/callback` = `tauri://localhost`, which providers reject (`ConnectionsPanel.tsx:16`). Fix: loopback `127.0.0.1:<port>` listener or device-code flow.
106. **(H)** No local Matrix homeserver shipped — `matrix-shim` target (`127.0.0.1:6167`, Conduit sidecar) is unwired; the workroom sovereignty story has no server (`matrix-shim.ts:39`). Fix: bundle/sidecar conduwuit + wire the client.
107. **(H)** Matrix client is login + room-list only — no `/sync`, no send, no E2E; rooms non-clickable, unread badge dead (`auth/providers/matrix.ts`; `MatrixPanel.tsx:67`). Fix: matrix-js-sdk (sync+crypto) + timeline.
108. **(H)** The "BitTorrent swarm" has no P2P transport — in-memory Map + magnet *strings* only, single-node, no peer fetch (`artifact-swarm.ts:56`). Fix: real webtorrent/libp2p, or drop the framing.
109. **(M)** Two disconnected artifact stores — user `ArtifactsSurface` is localStorage; the content-addressed CMS/swarm is only reachable from the dev Lab (`artifacts/storage.ts:7`). Fix: back ArtifactsSurface with the CMS caps.
110. **(M)** OfficeViewer is client-JS only; `.pptx/.odt/.ppt/.pdf` hit a placeholder despite a working `soffice` backend that it never fetches (`OfficeViewer.tsx:81`; `office-toolkit.ts:34`). Fix: wire to `/api/cap/office-convert`.
111. **(H)** Code-execution "sandbox" has no real isolation — Node `vm` + host `python3 -c`; the Next `/api/execute` route passes full `process.env` to model-authored code (secrets) (`app/api/execute/route.ts:98,145`). Fix: nsjail/firejail/container + env allowlist.

---

## Top-10 highest leverage (do first)
1. **#91 Linux embed-sidecar build** — unblocks release-linux immediately (mechanical, mirror the macOS fix).
2. **#36 wire `rag-trust`** — close the live PoisonedRAG injection hole (built, just call it).
3. **#80/#81 secrets → OS keychain** — plaintext API keys + OAuth refresh tokens is the most acute classic exposure.
4. **#79/#82/#86 centralize kill-switch + auth on `/api/containment` + anchor the attested lane** — containment is currently bypassable by a local page.
5. **#90 egress target from resolved URL** — the new OpenRouter/HF lane currently bypasses scope-d's authorizedTargets.
6. **#48/#49 bundle whisper+ffmpeg + auto-provision XTTS** — the chosen sovereign-voice build; makes voice work zero-key.
7. **#17/#19 fix the dead Memory lens + separate LearningState exhaust** — directly fixes "the graph is trash / all the same."
8. **#33/#34 unify embedder + add ANN index** — correctness (incomparable vectors) + scale.
9. **#63/#64 backend-unreachable banner + kill the 14 silent graph catches** — the #1 "looks broken" driver.
10. **#97/#96 smoke-test the running bundle + Linux validate job** — stops dead bundles shipping green.
