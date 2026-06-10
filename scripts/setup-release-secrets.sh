#!/usr/bin/env bash
# setup-release-secrets.sh
#
# Sets GitHub Actions secrets required for Noetica release CI.
# Run once after cloning; re-run any time a secret rotates.
#
# Prerequisites:
#   - gh CLI authenticated: gh auth login
#   - Targeting repo: SocioProphet/Noetica (or override via NOETICA_REPO env)

set -euo pipefail

REPO="${NOETICA_REPO:-SocioProphet/Noetica}"

echo ""
echo "▸ Noetica release secret setup"
echo "  Repo: $REPO"
echo ""

# ── Helpers ────────────────────────────────────────────────────────────────────

secret_set() {
  local name="$1" value="$2"
  echo "$value" | gh secret set "$name" --repo "$REPO" --body -
  echo "  ✓ $name"
}

require_var() {
  local var="$1" hint="$2"
  if [ -z "${!var:-}" ]; then
    echo ""
    echo "  ✗ \$$var is not set."
    echo "    $hint"
    echo ""
    exit 1
  fi
}

# ── 1. TAP_GITHUB_TOKEN ────────────────────────────────────────────────────────
#
# A classic GitHub Personal Access Token (PAT) with 'repo' scope and write
# access to SocioProphet/homebrew-tap. The release workflow uses it to push
# the updated Cask formula after each tagged release.
#
# How to create:
#   1. Open https://github.com/settings/tokens/new (classic)
#   2. Name: "noetica-tap-bot"  |  Scopes: ✓ repo
#   3. Copy the generated token (ghp_…)
#   4. Set env var:  export TAP_GITHUB_TOKEN=ghp_...
#   5. Re-run this script.

echo "── 1 / 3  TAP_GITHUB_TOKEN ──────────────────────────────────────────────"
if [ -z "${TAP_GITHUB_TOKEN:-}" ]; then
  echo ""
  echo "  TAP_GITHUB_TOKEN is not set — skipping."
  echo ""
  echo "  To enable automated Homebrew cask updates:"
  echo "    1. Create a classic PAT at https://github.com/settings/tokens/new"
  echo "       Name: noetica-tap-bot | Scope: repo"
  echo "    2. export TAP_GITHUB_TOKEN=ghp_..."
  echo "    3. Re-run this script."
  echo ""
else
  secret_set "TAP_GITHUB_TOKEN" "$TAP_GITHUB_TOKEN"
fi

# ── 2. Apple signing + notarization ───────────────────────────────────────────
#
# Enables signed + notarized .dmg builds (Gatekeeper-compatible).
# Without these the release still builds; macOS will show an unverified warning.
#
# Prerequisites:
#   • Apple Developer Program membership (developer.apple.com)
#   • "Developer ID Application" certificate exported from Keychain as .p12
#   • App-specific password from https://appleid.apple.com → App-Specific Passwords
#
# Required env vars before running:
#   APPLE_P12_PATH             Path to your exported .p12 certificate file
#   APPLE_CERTIFICATE_PASSWORD Password you set when exporting the .p12
#   APPLE_SIGNING_IDENTITY     e.g. "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID                   Your Apple ID email (used for notarization)
#   APPLE_PASSWORD             App-specific password (not your Apple ID password)
#   APPLE_TEAM_ID              10-char team ID from developer.apple.com

echo "── 2 / 3  Apple signing ─────────────────────────────────────────────────"

APPLE_VARS=(APPLE_P12_PATH APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID)
APPLE_MISSING=()
for v in "${APPLE_VARS[@]}"; do
  [ -z "${!v:-}" ] && APPLE_MISSING+=("$v")
done

if [ ${#APPLE_MISSING[@]} -gt 0 ]; then
  echo ""
  echo "  Apple signing vars not set — skipping."
  echo "  Missing: ${APPLE_MISSING[*]}"
  echo ""
  echo "  To enable code signing + notarization:"
  echo "    1. Export your Developer ID Application cert from Keychain as .p12"
  echo "    2. Create an app-specific password at https://appleid.apple.com"
  echo "    3. Set all of: ${APPLE_VARS[*]}"
  echo "    4. Re-run this script."
  echo ""
else
  require_var APPLE_P12_PATH "Path to your exported .p12 file"
  if [ ! -f "$APPLE_P12_PATH" ]; then
    echo "  ✗ APPLE_P12_PATH file not found: $APPLE_P12_PATH"
    exit 1
  fi

  CERT_B64=$(base64 < "$APPLE_P12_PATH")
  secret_set "APPLE_CERTIFICATE"          "$CERT_B64"
  secret_set "APPLE_CERTIFICATE_PASSWORD" "$APPLE_CERTIFICATE_PASSWORD"
  secret_set "APPLE_SIGNING_IDENTITY"     "$APPLE_SIGNING_IDENTITY"
  secret_set "APPLE_ID"                   "$APPLE_ID"
  secret_set "APPLE_PASSWORD"             "$APPLE_PASSWORD"
  secret_set "APPLE_TEAM_ID"              "$APPLE_TEAM_ID"
fi

# ── 3. Summary ────────────────────────────────────────────────────────────────

echo "── 3 / 3  Current secret inventory ─────────────────────────────────────"
echo ""
gh secret list --repo "$REPO" 2>/dev/null || echo "  (none)"
echo ""
echo "  TAP_REPO variable:"
gh variable list --repo "$REPO" 2>/dev/null | grep TAP_REPO || echo "  (not set)"
echo ""
echo "Done. Push a tag to trigger a release:"
echo "  git tag v0.1.0 && git push origin v0.1.0"
echo ""
