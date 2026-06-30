# Web tier — browser launch for the Prophet Platform + Workspace/one

The desktop app loads a static export from `tauri://localhost` and reaches the API only on the
loopback sidecar. To serve **both surfaces in a browser** (the launch bar — comparable at a high
level to Google Cloud / IBM Cloud Pak for Data), this tier adds one public origin that:

1. **serves the built static UI** (the Next `out/` export), and
2. **reverse-proxies the entire `/api/*` + `/health` surface** to the `agent-machine` sidecar, which
   exposes the complete ~190-route platform + workspace API.

Going straight to the sidecar (not the ~25 Next `app/api` route handlers, which were themselves just
localhost proxies) means the browser gets the *full* API with no per-route shim.

```
browser ──▶ ingress (TLS, auth)  ──▶  web-gateway :8088
                                         ├─ /api/*, /health  ──▶ agent-machine :8080  (full API)
                                         └─ everything else   ──▶ static out/  (the SPA, with fallback)
```

## Run it

Via compose (recommended — the `web` service is wired in `docker-compose.yml`):

```bash
docker compose up --build web agent-machine ollama hellgraph
# open http://localhost:8088
```

Standalone (against an already-running sidecar):

```bash
NOETICA_STATIC_EXPORT=1 npm run build:static          # produces ./out
NOETICA_AM_ENDPOINT=http://127.0.0.1:8080 \
GATEWAY_STATIC_DIR=./out node deploy/web-gateway/gateway.mjs
```

## Required sidecar settings for a hosted launch

These are **off by default** so the desktop app is unaffected. Set them only behind the gateway:

| Env (on `agent-machine`) | Value | Why |
|---|---|---|
| `NOETICA_BIND_HOST` | `0.0.0.0` | the gateway is a different container and can't reach `127.0.0.1` of the sidecar |
| `NOETICA_ALLOWED_ORIGINS` | `https://app.example.com` | the browser's `Origin` is the public domain, not loopback — the DNS-rebinding guard rejects it otherwise |
| `NOETICA_API_TOKEN` | a secret | turn on auth for mutating routes (single-user→shared requires this at minimum) |

## Gateway env

| Env | Default | Meaning |
|---|---|---|
| `GATEWAY_PORT` | `8088` | listen port |
| `GATEWAY_HOST` | `0.0.0.0` | bind host (it's the public tier, behind ingress) |
| `NOETICA_AM_ENDPOINT` | `http://127.0.0.1:8080` | sidecar base URL |
| `GATEWAY_STATIC_DIR` | `../../out` | built static UI directory |

## Not in this tier (front it / stack on top)

- **TLS** — terminate at the ingress/load balancer in front of the gateway.
- **Multi-tenant auth / RBAC** — `NOETICA_API_TOKEN` is shared-secret; per-user/tenant isolation
  (built on `sovereign-id`) is the next layer up and tracked separately.
