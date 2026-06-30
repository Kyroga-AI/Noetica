# web-gateway — the browser tier: builds the static UI and serves it + reverse-proxies /api/* to the sidecar.
#
# Stage 1 builds the Next static export (out/). Stage 2 is a tiny node runtime that runs the
# zero-dependency gateway over that export. TLS + auth terminate at the ingress in front of this.

# ── Stage 1: build the static UI ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
# Static export targets a hosted browser, not tauri://localhost.
RUN NOETICA_STATIC_EXPORT=1 npm run build:static

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /srv
COPY --from=build /app/out ./out
COPY deploy/web-gateway/gateway.mjs ./gateway.mjs
ENV GATEWAY_PORT=8088 \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_STATIC_DIR=/srv/out \
    NOETICA_AM_ENDPOINT=http://agent-machine:8080
EXPOSE 8088
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8088/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "gateway.mjs"]
