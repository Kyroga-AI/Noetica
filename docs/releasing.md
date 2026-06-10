# Releasing Noetica

## One-time setup

Run the setup script to wire all required CI secrets:

```bash
scripts/setup-release-secrets.sh
```

The script is interactive — it skips any secret group whose env vars aren't set and prints exactly what's missing and how to obtain it.

### TAP_GITHUB_TOKEN (required for Homebrew cask auto-update)

1. Create a classic PAT at <https://github.com/settings/tokens/new>  
   Name: `noetica-tap-bot` | Scope: `repo`
2. `export TAP_GITHUB_TOKEN=ghp_...`
3. Re-run `scripts/setup-release-secrets.sh`

`TAP_REPO=SocioProphet/homebrew-tap` is already set as a repo variable. The Cask formula lives at  
`Casks/noetica.rb` in that repo — CI overwrites version/url/sha256 automatically.

### Apple signing + notarization (required for Gatekeeper-signed builds)

Without signing the release still builds and runs — macOS shows an "unverified developer" prompt.

Export your **Developer ID Application** certificate from Keychain as a `.p12`, then:

```bash
export APPLE_P12_PATH=/path/to/cert.p12
export APPLE_CERTIFICATE_PASSWORD=<p12-export-password>
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID=you@example.com
export APPLE_PASSWORD=<app-specific-password>   # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID=XXXXXXXXXX
scripts/setup-release-secrets.sh
```

## Cutting a release

```bash
git tag v0.X.Y && git push origin v0.X.Y
```

The `release` workflow triggers on version tags. It will:

1. Typecheck + lint
2. Build the signed `.dmg` (macOS)
3. Create a **draft** GitHub Release with the dmg attached
4. Update `Casks/noetica.rb` in the homebrew tap with the new version/url/sha256
5. Publish the draft (do this manually after review)

Users can then install via:

```bash
brew install --cask SocioProphet/tap/noetica
```

## Secrets inventory

| Secret / Variable | Where set | Purpose |
|---|---|---|
| `TAP_REPO` | Repo variable | Enables the cask update job |
| `TAP_GITHUB_TOKEN` | Repo secret | Push access to `homebrew-tap` |
| `APPLE_CERTIFICATE` | Repo secret | Base64 .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Repo secret | .p12 export password |
| `APPLE_SIGNING_IDENTITY` | Repo secret | Codesign identity string |
| `APPLE_ID` | Repo secret | Notarization Apple ID |
| `APPLE_PASSWORD` | Repo secret | App-specific password |
| `APPLE_TEAM_ID` | Repo secret | 10-char developer team ID |
