/**
 * sovereign-broker-server — runnable HTTP front for the broker (node:http, zero extra deps).
 *
 * Endpoints:
 *   GET  /authorize                  OIDC authorization page (sovereign login UI)
 *   POST /authorize                  Receive browser assertion, issue auth code, redirect
 *   POST /token                      Auth code exchange → access_token + id_token
 *   GET  /userinfo                   Bearer token → OIDC claims
 *   POST /credentials                Enroll a credential (direct assertion flow)
 *   POST /challenge {scope,pseudonym} One-time challenge for direct assertion flow
 *   POST /verify   <assertion>       Direct assertion verify → id_token
 *   GET  /.well-known/openid-configuration  OIDC discovery
 *   GET  /.well-known/jwks.json             JWKS
 *   GET  /healthz
 */
import * as http from "node:http";
import * as fs from "node:fs";
import { createBroker, type ClientConfig } from "./sovereign-broker-service.js";
import { generateSigningKey, signingKeyFromPem, type SigningKey } from "./sovereign-oidc.js";

function loadSigningKey(): SigningKey {
  const path = process.env["BROKER_SIGNING_KEY"] ?? "/etc/broker/signing/ed25519.key";
  try { return signingKeyFromPem(fs.readFileSync(path, "utf8")); }
  catch (e) {
    if (process.env["NODE_ENV"] === "production" || process.env["BROKER_REQUIRE_KEY"] === "1")
      throw new Error(`broker signing key required but unreadable at ${path}: ${(e as Error).message}`);
    console.warn(`[broker] no signing key at ${path} — using EPHEMERAL dev key (tokens won't survive restart)`);
    return generateSigningKey();
  }
}

function loadClientRegistry(): Record<string, ClientConfig> {
  const raw = process.env["BROKER_CLIENTS"];
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, ClientConfig>; }
  catch { console.warn("[broker] BROKER_CLIENTS is not valid JSON — no clients registered"); return {}; }
}

// Minimal sovereign login page — all crypto runs in the browser (root never leaves the device).
// Uses WebCrypto (HKDF + Ed25519) to derive the scope-specific facet key from the root seed,
// signs the server challenge, and POSTs the assertion back.
function loginPage(opts: { challenge: string; authNonce: string; clientId: string; appName: string }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sovereign Login — ${esc(opts.appName)}</title>
<style>
  :root{--bg:#0f0f0f;--fg:#f0f0f0;--accent:#7c3aed;--card:#161616;--border:#2a2a2a;--err:#ef4444;--sub:#777}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{width:380px;padding:40px;background:var(--card);border:1px solid var(--border);border-radius:12px}
  .logo{font-size:20px;font-weight:700;letter-spacing:-.5px;margin-bottom:6px}
  .sub{font-size:13px;color:var(--sub);margin-bottom:32px}
  label{display:block;font-size:11px;color:#999;margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase}
  input{width:100%;padding:10px 14px;background:#1a1a1a;border:1px solid var(--border);border-radius:8px;
    color:var(--fg);font-size:14px;outline:none;font-family:'SF Mono','Fira Code',monospace}
  input:focus{border-color:var(--accent)}
  button{width:100%;margin-top:20px;padding:12px;background:var(--accent);color:#fff;border:none;
    border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s}
  button:disabled{opacity:.4;cursor:not-allowed}
  .hint{margin-top:14px;font-size:12px;color:var(--sub);text-align:center}
  .err{margin-top:12px;padding:10px 14px;background:rgba(239,68,68,.08);border:1px solid var(--err);
    border-radius:8px;font-size:13px;color:var(--err);display:none}
</style>
</head>
<body>
<div class="card">
  <div class="logo">⬡ ${esc(opts.appName)}</div>
  <div class="sub">Sovereign Identity — ${esc(opts.clientId)}</div>
  <label for="seed">Root Seed (hex) or passphrase</label>
  <input type="password" id="seed" placeholder="64 hex chars or a strong passphrase"
         autocomplete="off" spellcheck="false">
  <div class="err" id="errBox"></div>
  <button id="btn" onclick="login()">Continue</button>
  <div class="hint">Your key never leaves this device.</div>
</div>
<script>
const CHALLENGE = ${JSON.stringify(opts.challenge)};
const AUTH_NONCE = ${JSON.stringify(opts.authNonce)};
const CLIENT_ID  = ${JSON.stringify(opts.clientId)};

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,'');
}
function hexToBytes(hex) {
  if (hex.length !== 64) throw new Error('Root seed must be 64 hex characters (32 bytes)');
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return b;
}
async function seedToBytes(input) {
  input = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(input)) return hexToBytes(input);
  // Passphrase: PBKDF2 → 32 bytes
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(input), {name:'PBKDF2'}, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', hash:'SHA-256', salt:enc.encode('sovereign-root-v1'), iterations:100000}, km, 256);
  return new Uint8Array(bits);
}
async function deriveEd25519(rootBytes, scopeId) {
  const enc = new TextEncoder();
  // HKDF(root, salt=scopeId, info='') → 32-byte Ed25519 seed — mirrors sovereign-id.ts
  const rootKey = await crypto.subtle.importKey('raw', rootBytes, {name:'HKDF'}, false, ['deriveBits']);
  const facetBits = await crypto.subtle.deriveBits(
    {name:'HKDF', hash:'SHA-256', salt:enc.encode(scopeId), info:new Uint8Array()}, rootKey, 256);
  const seed = new Uint8Array(facetBits);
  // PKCS#8 for Ed25519 (RFC 8410): fixed 16-byte header + 32-byte seed
  const hdr = new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const pkcs8 = new Uint8Array(hdr.length + 32);
  pkcs8.set(hdr); pkcs8.set(seed, hdr.length);
  const privKey = await crypto.subtle.importKey('pkcs8', pkcs8, {name:'Ed25519'}, true, ['sign']);
  // Extract public key via JWK (x field = raw pubkey, base64url)
  const jwk = await crypto.subtle.exportKey('jwk', privKey);
  const pubBytes = Uint8Array.from(atob(jwk.x.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
  return {privKey, pubBytes};
}
async function login() {
  const btn = document.getElementById('btn');
  const box = document.getElementById('errBox');
  box.style.display = 'none';
  const seedInput = document.getElementById('seed').value;
  if (!seedInput.trim()) { showErr('Enter your root seed or passphrase.'); return; }
  btn.disabled = true;
  try {
    const rootBytes = await seedToBytes(seedInput);
    const {privKey, pubBytes} = await deriveEd25519(rootBytes, CLIENT_ID);
    // Pseudonym = hex of first 16 bytes of SHA-256(pubkey)
    const hashBuf = await crypto.subtle.digest('SHA-256', pubBytes);
    const pseudonym = Array.from(new Uint8Array(hashBuf).slice(0,16), b => b.toString(16).padStart(2,'0')).join('');
    // Sign challenge:authNonce
    const payload = new TextEncoder().encode(CHALLENGE + ':' + AUTH_NONCE);
    const sig = await crypto.subtle.sign('Ed25519', privKey, payload);
    const resp = await fetch(location.pathname + location.search, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        auth_nonce: AUTH_NONCE,
        pseudonym,
        public_key: b64url(pubBytes),
        signature: b64url(sig),
      })
    });
    const data = await resp.json();
    if (data.redirect) { location.href = data.redirect; return; }
    showErr(data.error || 'Login failed — check your seed and try again.');
    btn.disabled = false;
  } catch(e) {
    showErr(e.message || 'Login failed');
    btn.disabled = false;
  }
}
function showErr(msg) {
  const el = document.getElementById('errBox');
  el.textContent = msg; el.style.display = 'block';
}
document.getElementById('seed').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
</script>
</body>
</html>`;
}

const MAX_BODY = 256 * 1024;
const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let b = ""; let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(new Error("payload too large")); return; }
      b += c;
    });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) as Record<string, unknown> : {}); } catch { resolve({}); } });
    req.on("error", reject);
  });

type CreateOpts = { iss?: string; signingKey?: SigningKey; ttlSec?: number; clients?: Record<string, ClientConfig> };

export function createBrokerServer(opts: CreateOpts = {}): http.Server {
  const iss = opts.iss ?? process.env["BROKER_ISS"] ?? "http://localhost:8089";
  const appName = process.env["BROKER_APP_NAME"] ?? "Prophet Workspace";
  const broker = createBroker({
    iss,
    signingKey: opts.signingKey ?? loadSigningKey(),
    ttlSec: opts.ttlSec ?? Number(process.env["BROKER_TOKEN_TTL"] ?? 3600),
    clients: opts.clients ?? loadClientRegistry(),
    allowAllRedirectUris: process.env["NODE_ENV"] !== "production",
  });

  const send = (res: http.ServerResponse, r: { status: number; body: unknown }): void => {
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    try {
      // ── OIDC discovery ──────────────────────────────────────────────────────
      if (req.method === "GET" && p === "/.well-known/openid-configuration") return send(res, broker.discovery());
      if (req.method === "GET" && p === "/.well-known/jwks.json") return send(res, broker.jwksDoc());
      if (req.method === "GET" && p === "/healthz") return send(res, { status: 200, body: { ok: true } });

      // ── OIDC authorization-code flow ────────────────────────────────────────
      if (req.method === "GET" && p === "/authorize") {
        const q = url.searchParams;
        const result = broker.authorizeStart({
          client_id: q.get("client_id") ?? "",
          redirect_uri: q.get("redirect_uri") ?? "",
          scope: q.get("scope") ?? "openid",
          state: q.get("state") ?? undefined,
          nonce: q.get("nonce") ?? undefined,
          code_challenge: q.get("code_challenge") ?? undefined,
          code_challenge_method: q.get("code_challenge_method") ?? undefined,
        });
        if (result.status !== 200) return send(res, result);
        const { challenge, auth_nonce } = result.body as { challenge: string; auth_nonce: string };
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff",
        });
        res.end(loginPage({ challenge, authNonce: auth_nonce, clientId: q.get("client_id") ?? "", appName }));
        return;
      }
      if (req.method === "POST" && p === "/authorize") {
        type AssertionBody = { auth_nonce: string; pseudonym: string; public_key: string; signature: string; alias_email?: string };
        return send(res, broker.authorizeComplete((await readJson(req)) as AssertionBody));
      }

      // ── Token endpoint ──────────────────────────────────────────────────────
      if (req.method === "POST" && p === "/token") {
        const body = await readJson(req) as { grant_type?: string; code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string; client_secret?: string };
        if (body.grant_type !== "authorization_code")
          return send(res, { status: 400, body: { error: "unsupported_grant_type" } });
        return send(res, broker.exchangeCode({
          code: String(body.code ?? ""),
          client_id: String(body.client_id ?? ""),
          redirect_uri: String(body.redirect_uri ?? ""),
          code_verifier: body.code_verifier ? String(body.code_verifier) : undefined,
          client_secret: body.client_secret ? String(body.client_secret) : undefined,
        }));
      }

      // ── UserInfo endpoint ───────────────────────────────────────────────────
      if (req.method === "GET" && p === "/userinfo") {
        const auth = String(req.headers["authorization"] ?? "");
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return send(res, { status: 401, body: { error: "missing authorization" } });
        return send(res, broker.userInfo(token));
      }

      // ── Direct assertion flow (native edge clients) ─────────────────────────
      if (req.method === "POST" && p === "/credentials") return send(res, broker.enroll((await readJson(req)) as never));
      if (req.method === "POST" && p === "/challenge") {
        const b = await readJson(req);
        return send(res, broker.challenge(String(b["scope"]), String(b["pseudonym"])));
      }
      if (req.method === "POST" && p === "/verify") return send(res, broker.verifyAssertion((await readJson(req)) as never));

      send(res, { status: 404, body: { error: "not found" } });
    } catch (e) {
      send(res, { status: 500, body: { error: (e as Error).message } });
    }
  });
}

export function startBroker(port = Number(process.env["PORT"] ?? 8089)): http.Server {
  const server = createBrokerServer();
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.listen(port, () => console.log(`sovereign-broker listening on :${port}`));
  return server;
}
