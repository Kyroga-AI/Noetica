# Landing plan — sovereign security lane + scope-d gate

Status as of 2026-06-21 (late). Everything below typechecks (root 0 / agent-machine clean)
and passes tests (20/20). This doc is the pickup point for the next session.

## What was built (4 features, one body of work)

1. **Attested multi-rung security lane** — the `security` policy profile arms an uncensored
   lane only under operator **self-attestation**. Rungs resolve by request lean:
   - offensive → `jimscard/whiterabbit-neo:13b` (pulled, installed)
   - defensive → `huihui_ai/foundation-sec-abliterated:8b` (pulled, installed)
   - fallback → `dolphin3:8b` → `qwen2.5:14b`
   Unattested → standard local model. CBRN/CSAM/explosives content floor is NOT lifted.
   Files: `agent-machine/lib/router.ts`, `server.ts` (committed), `PolicyPanel.tsx`.

2. **Ephemeral / obliterate-on-armed** — while armed, chats are ephemeral and obliterated
   after `securityEphemeralMinutes` (default 15, sliding window). Reaper flushes removal to
   disk; disarm obliterates immediately; memory writes suppressed; audit content-redacted.
   Files: `lib/session/{types,manager,useSession}.ts`, `AppShell.tsx` (committed),
   `lib/settings/{types,defaults}.ts`.

3. **Tor / bearbrowser signal** — agent-machine writes `~/.config/sourceos/noetica/
   security-state.json` (`{armed, tor}`) on arm/disarm + exposes `GET /api/security/state`.
   Files: `server.ts` (committed). **Open:** the consumer lives in `sourceos-linux/bearbrowser`
   (separate repo, not checked out) — needs a ~10-line poller to toggle Tor.

4. **scope-d engagement-policy gate** — the mesh gates cloud egress against a scope-d
   `EngagementPolicy` (real contract from `SocioProphet/scope-d`). Local = no egress = always
   allowed (sovereignty floor); cloud denied when out-of-scope / not in authorizedTargets /
   network_call gated / policy expired/missing (fail-closed) → routes down to local. Emits
   `Event-IR` audit records (validated against scope-d's own schema).
   Files: `agent-machine/lib/scope-d.ts` (+ test). NOT yet committed.

## Git state

Branch: `feat/graph-drilldown`. Some of this work is already committed (`server.ts`,
`AppShell.tsx`, `defaults.ts`, `noeticaService.ts` rode along in `91cd284`).

Still uncommitted (working tree):
- `agent-machine/lib/router.ts`, `router.test.ts`
- `agent-machine/lib/scope-d.ts`, `scope-d.test.ts` (untracked)
- `lib/session/{types,manager,useSession}.ts`
- `lib/settings/types.ts`
- `app/api/chat/route.ts`
- `components/settings/panels/PolicyPanel.tsx`

## Tomorrow — steps to land it

1. **Decide the branch.** This is a distinct feature from graph-drilldown. Recommended:
   cut `feat/sovereign-security-lane` from current HEAD and commit the remaining files there;
   or keep on `feat/graph-drilldown` if shipping together. (Server-side already committed there.)
2. **Commit the rest in coherent chunks:**
   - `feat(security): attested multi-rung uncensored lane (router + policy panel)`
   - `feat(security): ephemeral obliterate-on-armed sessions`
   - `feat(mesh): scope-d engagement-policy egress gate + Event-IR audit`
3. **Run the full suite once:** `cd agent-machine && npm test` (note: pre-existing
   `embed-runtime.ts` import.meta tsc warning is unrelated — ignore).
4. **Finish the two open threads:**
   - bearbrowser Tor poller — check out `sourceos-linux/bearbrowser`, add the
     `GET /api/security/state` poll → Tor toggle.
   - scope-d facet 4 (capability confinement) — needs scope-d's capability-gate contract
     wired into the tool-exec env (seam exists; deferred to avoid a no-op in the spawn path).
5. **Yahoo Finance + charts** (unstarted) — still needs a scope decision: new Finance
   surface vs. agent data-tool (yfinance → existing matplotlib artifact pipeline) vs.
   retrieval source. Pick one, then build.

## How to run it

```bash
# security lane (models already pulled):
#   Settings → Policy → Security → "I attest — arm the security lane"
#   offensive prompt → whiterabbit-neo ; defensive → foundation-sec ; unattested → local

# scope-d gate (optional — only gates when configured):
export SCOPED_ENGAGEMENT_POLICY=~/dev/scope-d/examples/scope-d/engagement-policy.synthetic.json
export SCOPED_EVENTS=~/.noetica/scope-d/events.jsonl   # optional audit sink
# With the synthetic-lab policy, cloud is out-of-scope → mesh stays fully local + audits.
```
