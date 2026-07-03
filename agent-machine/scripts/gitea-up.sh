#!/usr/bin/env bash
# gitea-up.sh — bring up a local Gitea Sovereign for the Workstation command center.
#
# Self-contained (does not touch the ~/dev/gitea-sovereign repo — that's another agent's lane).
# Binds host :3001 to dodge the Next.js dev server on :3000. Uses podman (this Mac's runtime;
# falls back to docker). Prints the GITEA_URL + token to paste into Noetica → Settings → Connections.
set -euo pipefail

PORT="${GITEA_PORT:-3001}"
NAME="noetica-gitea"
ADMIN_USER="${GITEA_ADMIN_USER:-sourceos}"
ADMIN_PASS="${GITEA_ADMIN_PASS:-changeme123}"
ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-admin@sourceos.local}"
IMAGE="${GITEA_IMAGE:-docker.io/gitea/gitea:1.26.2-rootless}"

RT="$(command -v podman || command -v docker || true)"
[ -z "$RT" ] && { echo "✗ need podman or docker on PATH"; exit 1; }
echo "· runtime: $RT"

# podman on macOS needs a running machine
if [[ "$RT" == *podman ]]; then
  podman machine inspect >/dev/null 2>&1 || { echo "✗ start podman first:  podman machine init && podman machine start"; exit 1; }
fi

if "$RT" ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "· container $NAME exists — (re)starting"; "$RT" start "$NAME" >/dev/null
else
  echo "· creating $NAME on :$PORT"
  "$RT" run -d --name "$NAME" \
    -p "${PORT}:3000" -p "2222:22" \
    -e GITEA__server__ROOT_URL="http://localhost:${PORT}/" \
    -e GITEA__service__DISABLE_REGISTRATION=true \
    -v "${NAME}-data:/var/lib/gitea" \
    "$IMAGE" >/dev/null
fi

BASE="http://localhost:${PORT}"
printf '· waiting for gitea'
for _ in $(seq 1 60); do
  if curl -fsS "${BASE}/api/v1/version" >/dev/null 2>&1; then echo " — up"; break; fi
  printf '.'; sleep 2
done

# admin user (idempotent) + a fresh API token
"$RT" exec "$NAME" gitea admin user create \
  --username "$ADMIN_USER" --password "$ADMIN_PASS" --email "$ADMIN_EMAIL" --admin --must-change-password=false \
  >/dev/null 2>&1 || echo "· admin user already exists"

TOKEN="$(curl -fsS -X POST "${BASE}/api/v1/users/${ADMIN_USER}/tokens" \
  -u "${ADMIN_USER}:${ADMIN_PASS}" -H 'content-type: application/json' \
  -d "{\"name\":\"noetica-$(date +%s)\",\"scopes\":[\"write:repository\",\"write:user\",\"read:organization\"]}" \
  | sed -n 's/.*"sha1":"\([^"]*\)".*/\1/p')"

echo
echo "════════════════════════════════════════════════"
echo " Gitea Sovereign is up."
echo "   Noetica → Settings → Connections → Source forge:"
echo "   Endpoint : ${BASE}"
echo "   Token    : ${TOKEN:-<token mint failed — check: $RT logs $NAME>}"
echo "   Web UI   : ${BASE}  (login ${ADMIN_USER} / ${ADMIN_PASS})"
echo "════════════════════════════════════════════════"
