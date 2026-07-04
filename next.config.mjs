/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.NOETICA_STATIC_EXPORT === '1' ? { output: 'export' } : {}),
  webpack: (config) => {
    // agent-machine/lib uses `.js` import specifiers for `.ts` files (ESM/bun convention). The
    // shared graph-surface module is imported by the Next API routes; without this alias webpack
    // can't resolve its ./topic-closure.js / ./graph-hygiene.js / ./cskg.js imports and the static
    // export SILENTLY breaks (build:static fails) — which froze the embedded desktop frontend at
    // the last good export. Map `.js` → prefer `.ts`/`.tsx` so those resolve.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js', '.jsx'] }
    // @socioprophet/hellgraph's bundle references its optional server-only P2P/native backends
    // (hypercore/autobase/corestore/hyperbee/hyperswarm + rocksdb) which are Node-only and never
    // run in the browser (federation + native storage are server/desktop-main concerns). Webpack's
    // browser/static build otherwise hard-fails on `Can't resolve 'hypercore'`. Resolve them to
    // empty for the client bundle — the engine already degrades gracefully when they're absent.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      hypercore: false, autobase: false, corestore: false, hyperbee: false, hyperswarm: false, rocksdb: false,
    }
    return config
  },
}

export default nextConfig
