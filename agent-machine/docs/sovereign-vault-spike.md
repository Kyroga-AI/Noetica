# Sovereign Vault — Design Spike + Pressure-Test

**Date:** 2026-07-19  **Status:** design spike, no production writes  **Author:** Michael + Claude
**Origin:** evaluated Skyflow; want to adopt the good idea without their patents, made local-first.

---

## TL;DR verdict

Building "a sovereign Skyflow" (a PII data-privacy vault) **fails the pressure test** — wrong buyer economics, crowded field, and a certification moat we can't shortcut. And our "decrypt in-boundary, return only the result" isolation story is **not real in the code today** — key + plaintext + agent loop share one process.

But the *primitive* is worth building if we re-scope it: **not a vault product, but sovereign infrastructure for running AI agents over sensitive data, with epistemic provenance bonded to the computation.** That intersection — vault × agent-runtime × provenance — is one nobody owns, because each incumbent owns only one third of it. Keep the tech, kill the "compete with Skyflow" framing.

---

## Part 1 — External pressure-test (what the market says)

Sourced research; the hard truths, not the encouraging ones.

1. **The buyer's budget line is "shrink my PCI/HIPAA audit scope" — and sovereignty does the opposite.** Tokenization gets bought because the vendor moves sensitive data *out* onto their PCI-L1 systems, so the customer's audit footprint shrinks and liability transfers. An in-customer-boundary vault keeps the data — and the scope — inside the customer. We'd be selling *control* to a buyer whose PO says *"make my audit smaller."* Those are different value props; the second is the funded one. [PCI scope reduction](https://www.ixopay.com/blog/the-benefits-of-tokenization-for-reducing-pci-scope), [Curbstone](https://curbstone.com/tokenization-pci-compliance/)

2. **"In-boundary vault" is already occupied.** Piiano deploys in *your own cloud* (BYOC), Protegrity is on-prem/hybrid enterprise-grade, Evervault runs Relay inside the customer VPC. It's a recognized architecture, not a wedge. [Piiano BYOC](https://docs.piiano.com/guides/install/hosted), [Protegrity vaultless](https://www.protegrity.com/capabilities/vaultless-tokenization), [Evervault Relay](https://evervault.com/blog/how-we-built-relay)

3. **The moat is certifications, not tech — and it's ~12–24 months + real money.** Skyflow leads with PCI **Level 1 Service Provider** + SOC 2 Type II + ISO 27001 + HIPAA + card-network registry listings, *not* its patent. A sovereign model makes the *customer's* environment the audited surface, which removes the very thing buyers pay a vault for. [Skyflow security](https://www.skyflow.com/security), [PCI L1 announcement](https://www.skyflow.com/post/skyflow-achieves-pci-level-1-service-provider-certification)

4. **The patent is narrow — good for FTO, but it means we get no moat there either.** Skyflow's granted claim (**US12027073B2**) is limited to *dual-partition, operate-on-ciphertext-without-decryption* encryption. Our locally-HMAC'd join tokens almost certainly don't read on it — but that's because tokenization-as-reference is decades-old generic prior art, so it confers no defensible moat to *us* either. (A pending continuation **US20240331576A1** could broaden claims — a real FTO review is needed before relying on this.) [US12027073B2](https://patents.google.com/patent/US12027073B2/en)

5. **Epistemic provenance is a real regulatory tailwind — but it's an adjacent incumbent's budget line, not a vault's.** EU AI Act Art. 10 (training-data traceability) + Art. 50 (AI-content disclosure) ramp Aug 2 2026 with penalties to €35M/7%. But that spend goes to data-lineage/AI-governance vendors (Atlan, DataHub, Relyance) and content-provenance standards (C2PA, 6,000+ members). There is **no evidence of a PO for "cryptographic provenance bonded into a vault."** [EU AI Act lineage](https://www.techradar.com/pro/the-eu-ai-act-deadline-has-moved-but-data-lineage-cant-wait), [C2PA 2026](https://contentauthenticity.org/blog/the-state-of-content-authenticity-in-2026)

## Part 2 — Internal pressure-test (what our code says)

The "sovereign in-boundary vault" story has **no foundation in the code today**. Honest gaps:

1. **No hardware/enclave key isolation.** By default the AES-256-GCM key is a `0600` file *next to the ciphertext* (`agent-machine/lib/at-rest.ts:18,60`). The Secure-Enclave keychain path is opt-in and shipped disabled until the release is code-signed (`at-rest.ts:26-30`). Today it's software encryption-at-rest, not a custody boundary.
2. **No process/trust boundary around decryption.** The key (`_key` Buffer, `at-rest.ts:22`), plaintext, and the agent loop all share **one Node process** (the `:8080` sidecar, `server.ts:177`). "Decrypt in-boundary, return only the result" is **not achievable** — any code in the sidecar reads the key and every decrypted value. The only real boundaries are the localhost HTTP edge and the scope-d egress gate; neither isolates plaintext from the agent.
3. **No cell-level capability manifest / `operation_partition` PBAC.** Access is three disjoint coarse gates — `grantCheck` (revoke+trust, default-allow), `capability-egress` (arg tier), `scope-d` EngagementPolicy (egress target). None binds a manifest to an operation over an encrypted cell.
4. **Epistemic tier isn't produced at the derivation sites.** `buildRouterDecision` (`lib/router.ts:216`) and the `recordDispatch` sites (`server.ts:4057/4159/4219/5153`) fuse multiple inputs and emit **placeholder** `evidence:`/`audit:` refs with no input vector or output tier. The tier *math* exists (`rag-trust.deriveTrust`, weakest-input) — it's just not threaded through.
5. **Sovereign identity is not wired to encryption custody.** `deriveScope` gives per-boundary Ed25519 facets (`lib/sovereign-id.ts:59`), but the at-rest key is an unrelated random buffer. "Seal this cell to boundary X / only facet X can open" has no implementation.

## Part 3 — The reframe that survives

Stop selling a vault. The defensible position is the **intersection three incumbents each own only one third of**:

| Owns | Skyflow / Piiano | Atlan / DataHub / C2PA | **Noetica** |
|---|---|---|---|
| The vault (sealed sensitive data) | ✅ | ❌ | ✅ (this spike) |
| Data/AI lineage & provenance | ❌ | ✅ (of pipelines) | ✅ (of *agent reasoning*) |
| The agent runtime that derives claims | ❌ | ❌ | ✅ (proof-fabric, router) |

- **We are not a vault vendor.** The vault is a *component* of sovereign AI-over-sensitive-data. Our buyer is not "a fintech CISO reducing PCI scope" — it's an org that wants agents to reason over sensitive data **without it leaving their control**, with **every AI-derived claim carrying audit-grade provenance**. That's Noetica's existing thesis, made concrete for structured PII.
- **The wedge is provenance bonded to *computation*, not to pipelines.** Atlan/DataHub trace how data moved between tables; C2PA signs media. Neither propagates an epistemic tier through an *agent's* multi-input reasoning. That requires owning the vault *and* the runtime — which we do and they don't. This is the one axis where "nobody else can do it quickly" is actually true.
- **In-boundary matters for a different reason than PCI scope.** Not "shrink your audit" (it won't — say so plainly) but "the AI never ships your data to a frontier API." That's a value prop we already sell.
- **On the cloud tier:** do **not** build a managed multi-tenant vault — that's the certification-moat trap. If cloud, it's "our runtime deployed in the customer's VPC" (BYOC), same primitive, their boundary, and we never promise cert-inheritance or scope reduction.

## Part 4 — Extended technical design (grounded in real primitives)

### 4.1 Dual-axis SemanticCell
```
Cell = {
  value_sealed: enc:v1:...,              // AES-256-GCM (reuse at-rest.ts)
  operation_partition: search|join|rehydrate|aggregate,   // REQUIRED, fail-closed
  epistemic_tier: proved|bounded|empirical|synthetic|speculative|rejected, // REQUIRED
  boundary_ref: did:key:...              // sovereign-id facet the cell is sealed to
}
```
Write path extends `at-rest.ts` in place (do **not** fork). Reject writes missing either axis with a hard error, not a warning.

### 4.2 Make isolation real (fixes Part 2 gaps 1–2)
- **Dedicated Rust `vault-sidecar`** (our existing sidecar competence) that holds the key and exposes **only the four operations** over localhost. The Node agent process never receives the key or plaintext — only operation *results*:
  - `search` → match refs / booleans (plaintext stays in vault-sidecar)
  - `join` → deterministic HMAC join tokens (keyed locally; consistent; no plaintext)
  - `aggregate` → scalar (count/sum)
  - `rehydrate` → **the only op returning plaintext**; hardest capability gate
- This is the honest version of "decrypt in-boundary, return only the result" — the boundary is a *separate process*, not a comment. Optional hardware root via Secure Enclave / TPM (`device-attest.ts` already attempts `tpm2_quote`).

### 4.3 Key custody wired to sovereign identity (fixes gap 5)
Derive the vault key by **HKDF from `sovereign-root`** per `boundary_ref` (the HKDF-per-scope primitive already exists in `sovereign-id.ts:59`) — gives real "seal to boundary X / only facet X opens," replacing the unrelated `randomBytes(32)`.

### 4.4 `operation_partition` as real PBAC (fixes gap 3)
The **capability manifest** clears an agent for a partition; the `epistemic_tier` is returned **regardless of clearance** (never silently dropped or upgraded). Build the manifest schema on **scope-d's `EngagementPolicy`** (already contract-first + fail-closed); add a query-time `reject_below_tier: X` filter that is **distinct from access control**.

### 4.5 Epistemic propagation (fixes gap 4)
- **Define the ordinal enum fresh** (there is no existing one): `proved > bounded > empirical > synthetic > speculative > rejected`. Publish the total order + a documented map from existing `claim_class` strings (`empirical/reasoned` → `empirical`, `empirical/computational-verified` → `bounded`, `empirical/unverified` → `synthetic`, …). This map is the compatibility bridge to `proof-fabric.ts`.
- **`derive_epistemic(inputs) = min(tier)`** — reuse the proven weakest-input shape from `rag-trust.deriveTrust` (already runs in prod via `capability-egress`, so min-propagation is not a collapse-to-useless risk in practice). Enforce **at the mesh layer**, not per-agent.
- **Wire into the placeholder sites:** `buildRouterDecision` (`router.ts:216`) and the four `recordDispatch` sites. Sites that currently derive without touching provenance get **flagged as tracked tech-debt**, not silently patched.
- **UX rule:** when `min()` drags a mostly-`proved` result down, surface *which input* dragged it — don't soften the min. Soundness first.

### 4.6 The `rejected` decision (work order item 3)
**Recommendation: `rejected` is absorbing by default** — any rejected input forces the output to `rejected`. Rationale: a rejected input means the computation is built on something *known false*; silently excluding it launders the falsehood. Provide an **explicit, logged override** (`exclude_rejected: {reason}`) for the case where the rejected input was genuinely not load-bearing — excludable-with-attestation, never silent. Spike both; ship absorbing-default.

### 4.7 Audit extension (work order item 4)
Add `input_epistemic_vector`, `output_epistemic_tier`, `capability_manifest_ref`. **Cheap** in the free-form sinks (scope-d Event-IR, `audit-chain.AuditRecord` — the canonical hash absorbs new keys). **Invasive** in the typed sinks: `DispatchEntry` (`dispatch-ledger.ts:23-34`) + 4 call sites, and `GovernanceRun` (`server.ts:309`). The envelope is ready; the *producer* comes from 4.5. Confirm no scope-d / cloudshell-fog consumer breaks (they read free-form records, so additive keys are safe — verify).

### 4.8 Blocking item 5 — benchmark before merge
Benchmark dual-axis resolution vs. current single-axis lookup at Prophet Mesh scale. Produce numbers even if the caching fix is deferred. Likely strategy if latency is meaningful: precompute the `(operation_partition, boundary)` clearance into the capability manifest so query-time is a tier lookup + one manifest check, not two independent resolutions.

## Part 5 — Decisions needed / what I would NOT build

- **DECIDE:** is this a product line, or internal infra for the agent mesh? (Recommendation: internal infra first; the reframe in Part 3 only works if the runtime is the product and the vault is a component.)
- **DECIDE:** ship a BYOC cloud tier at all? (Recommendation: not until the on-device primitive is real; and never sold on audit-scope reduction.)
- **DO NOT BUILD:** a managed multi-tenant vault, any operate-on-ciphertext crypto (patent-fenced *and* unnecessary in-boundary), or a PII-vault product positioned against Skyflow.
- **NEEDS COUNSEL:** freedom-to-operate review of the pending Skyflow continuation before relying on the non-infringement read.

## Sources
Skyflow patent [US12027073B2](https://patents.google.com/patent/US12027073B2/en) · continuation [US20240331576A1](https://patents.google.com/patent/US20240331576A1/en) · [Skyflow security/certs](https://www.skyflow.com/security) · [Piiano BYOC](https://docs.piiano.com/guides/install/hosted) · [Protegrity](https://www.protegrity.com/capabilities/vaultless-tokenization) · [Evervault Relay](https://evervault.com/blog/how-we-built-relay) · [PCI scope reduction](https://www.ixopay.com/blog/the-benefits-of-tokenization-for-reducing-pci-scope) · [EU AI Act lineage](https://www.techradar.com/pro/the-eu-ai-act-deadline-has-moved-but-data-lineage-cant-wait) · [C2PA 2026](https://contentauthenticity.org/blog/the-state-of-content-authenticity-in-2026)
