# Anthropic API Key Integration

Owner: M. Heller / G. Quiroga · Scope: wire the Anthropic inference key for `POST /v1/messages`.
**Out of scope:** `GET/POST /v1/organizations/api_keys/*` (Admin API — redacted metadata only, not on the inference path).

Both architecture branches are implemented. Pick per deployment; they coexist.

---

## Hard constraints (enforced)
- **No key in source/config/logs/errors.** `.gitignore` covers `.env`, `.env.*`, `*.key`, `*.pem`, `secrets.json`, `*.secret`. Keys are read from the **OS keychain** (Branch A) or **proxy env** (Branch B) at runtime only.
- **No shared key in the desktop bundle.** The agent-machine sidecar runs *on the user's machine*, so a shared key there is extractable — it lives **only on the remote proxy** (Branch B).
- An Anthropic key seen in a public repo is **auto-deactivated** (GitHub secret-scanning). An accidental commit = a **rotation event**, not a `git rm`.

## Branch A — Bring-Your-Own-Key (DEFAULT, desktop)
The user supplies their own key. **Fully implemented:**
- **Entry + validation:** `components/shell/ProviderSetupModal.tsx` — enter the key, "Verify" does a 1-token `/api/chat` test call, then Save.
- **Storage = OS keychain:** `lib/settings/context.tsx` strips `SECRET_KEYS` (incl. `anthropicApiKey`) from the persisted settings blob and writes them to the keychain via `lib/secure/secureStore.ts` → Tauri `keychain_set/get/delete` (`keyring` crate: macOS Keychain / Windows Credential Manager / Linux Secret Service). **Never** in plaintext localStorage; a legacy-inline-secret migration strips any old ones on next save.
- **Use:** the key is sent per-request as `provider_keys.anthropic` → agent-machine → `POST https://api.anthropic.com/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01` + required `max_tokens` (`agent-machine/server.ts`).
- **Replace key:** re-open the modal / Settings → Models, enter a new key, Save (overwrites the keychain entry).

## Branch B — Shared key behind our remote proxy (managed offering)
The shared key lives **only** on a server we control. **Implemented:**
- **Proxy server:** `proxy/anthropic-proxy.mjs` — reads `ANTHROPIC_API_KEY` + `PROXY_TOKENS` from env, validates a per-user Bearer token, forwards `/v1/messages` to Anthropic (attaching `x-api-key`), streams the response, per-token rate cap. Deploy it remotely; **do not bundle it in the desktop app**.
- **Client routing:** when `NOETICA_ANTHROPIC_PROXY_URL` is set, the agent-machine routes Anthropic calls through the proxy with `Authorization: Bearer ${NOETICA_PROXY_TOKEN}` and **no `x-api-key`** (`anthropicTarget()` in `server.ts`). Anthropic becomes selectable even with no local key.

Deploy the proxy:
```bash
ANTHROPIC_API_KEY=sk-ant-…  PROXY_TOKENS=tok_alice,tok_bob  PORT=8788  node proxy/anthropic-proxy.mjs
# point the client at it:
NOETICA_ANTHROPIC_PROXY_URL=https://proxy.example.com/v1/messages  NOETICA_PROXY_TOKEN=tok_alice  <launch app>
```

## Provisioning (manual, one-time — not agent work)
- Console → `platform.claude.com/settings/keys` → Create Key. Name per env (`noetica-dev`, `noetica-prod`); scope to the workspace. Shown once — copy it. Separate key per environment.

## Error handling (implemented in server.ts)
- `401 authentication_error` → invalid/revoked key, wrong header, or whitespace. Branch A surfaces re-enter-key; Branch B → alert ops. Key never echoed.
- `400 invalid_request_error: model` → wrong/unentitled model string.
- `429` → exponential backoff + jitter, honors `retry-after`.

## Rotation runbook
1. Console → create a NEW key for the environment.
2. **Branch A:** users re-enter via the modal (overwrites keychain). **Branch B:** swap `ANTHROPIC_API_KEY` on the proxy (secret manager) → restart/rolling-deploy → verify `/health` + a test call.
3. Revoke the OLD key in Console once traffic is confirmed on the new one.
4. **If a key ever lands in a commit:** treat as compromised — rotate immediately (it's likely already auto-deactivated), then scrub history.

## Acceptance criteria — status
- [x] End-to-end `/v1/messages` round-trip (Branch A live; Branch B via proxy).
- [x] Zero key material in repo / working tree; `.gitignore` covers secret files (`git check-ignore` verified).
- [x] No key in the built client artifact (grep the desktop binary for `sk-ant-` — keys are keychain/proxy-env only).
- [x] (Branch A) Key in OS keychain; not in localStorage, not in JS memory at rest.
- [x] (Branch B) Key only server-side; client sends a Bearer token, never `x-api-key`.
- [x] Key never in logs/error output.
- [x] Rotation runbook documented (above).
