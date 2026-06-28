/**
 * sovereign-broker-server — the runnable HTTP front for the broker (node:http, zero extra deps). Mounts the proven
 * handlers (sovereign-broker-service) so Gitea/Matrix/mail/ONLYOFFICE/web can front the sovereign login via standard
 * OIDC. Loads the signing key from a mounted secret in prod; ephemeral key in dev. Holds only public material.
 *
 *   POST /credentials                      enroll a (edge-computed) credential
 *   POST /challenge {scope,pseudonym}      get a one-time challenge
 *   POST /verify   <assertion>             verify → standard OIDC id_token
 *   GET  /.well-known/openid-configuration discovery
 *   GET  /.well-known/jwks.json            JWKS
 */
import * as http from "node:http";
import * as fs from "node:fs";
import { createBroker } from "./sovereign-broker-service.js";
import { generateSigningKey, signingKeyFromPem, type SigningKey } from "./sovereign-oidc.js";

function loadSigningKey(): SigningKey {
  const path = process.env["BROKER_SIGNING_KEY"] ?? "/etc/broker/signing/ed25519.key";
  try { return signingKeyFromPem(fs.readFileSync(path, "utf8")); }
  catch { return generateSigningKey(); } // dev fallback: ephemeral key (tokens won't verify across restarts)
}

const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });

export function createBrokerServer(opts: { iss?: string; signingKey?: SigningKey; ttlSec?: number } = {}): http.Server {
  const iss = opts.iss ?? process.env["BROKER_ISS"] ?? "http://localhost:8089";
  const broker = createBroker({
    iss,
    signingKey: opts.signingKey ?? loadSigningKey(),
    ttlSec: opts.ttlSec ?? Number(process.env["BROKER_TOKEN_TTL"] ?? 3600),
  });
  const send = (res: http.ServerResponse, r: { status: number; body: unknown }): void => {
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  };

  return http.createServer(async (req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    try {
      if (req.method === "GET" && p === "/.well-known/openid-configuration") return send(res, broker.discovery());
      if (req.method === "GET" && p === "/.well-known/jwks.json") return send(res, broker.jwksDoc());
      if (req.method === "GET" && p === "/healthz") return send(res, { status: 200, body: { ok: true } });
      if (req.method === "POST" && p === "/credentials") return send(res, broker.enroll((await readJson(req)) as never));
      if (req.method === "POST" && p === "/challenge") { const b = await readJson(req); return send(res, broker.challenge(String(b["scope"]), String(b["pseudonym"]))); }
      if (req.method === "POST" && p === "/verify") return send(res, broker.verifyAssertion((await readJson(req)) as never));
      send(res, { status: 404, body: { error: "not found" } });
    } catch (e) { send(res, { status: 500, body: { error: (e as Error).message } }); }
  });
}

export function startBroker(port = Number(process.env["PORT"] ?? 8089)): http.Server {
  const server = createBrokerServer();
  server.listen(port, () => console.log(`sovereign-broker listening on :${port}`));
  return server;
}
