import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// App version = the single source of truth in package.json, injected at build so the UI can display it
// without drift. Build SHA is best-effort (absent in a git-less build) — shown alongside when present.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
let buildSha = ''
try { buildSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* no git → version only */ }

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkgVersion,
    NEXT_PUBLIC_BUILD_SHA: buildSha,
  },
  ...(process.env.NOETICA_STATIC_EXPORT === '1' ? { output: 'export' } : {}),
  webpack: (config) => {
    // agent-machine/lib uses `.js` import specifiers for `.ts` files (ESM/bun convention). The
    // shared graph-surface module is imported by the Next API routes; without this alias webpack
    // can't resolve its ./topic-closure.js / ./graph-hygiene.js / ./cskg.js imports and the static
    // export SILENTLY breaks (build:static fails) — which froze the embedded desktop frontend at
    // the last good export. Map `.js` → prefer `.ts`/`.tsx` so those resolve.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js', '.jsx'] }
    return config
  },
}

export default nextConfig
