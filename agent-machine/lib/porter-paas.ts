/**
 * porter-paas.ts — integrate Noetica with Porter (porter.run) for local-first development → deploy. Noetica
 * scaffolds + builds projects in ~/.noetica/workspaces; Porter takes those to a dev/prod environment with a
 * declarative app spec (porter.yaml v2). This generates the spec + the CLI commands (local run, apply, logs)
 * so a Noetica project becomes Porter-deployable without leaving the app. Local-first: `porter app run` runs
 * against the app's env locally before any cloud deploy.
 */
export interface PorterService { name: string; run: string; type: 'web' | 'worker' | 'job'; port?: number }
// Compute target — when broker:true, planPorterDeploy() routes it to the cheapest satisfying cloud via the
// multi-cloud broker. Model target — an AI model from the provider lane (ollama/anthropic/openai/openrouter/
// hf/hf.co GGUF); planPorterDeploy resolves the provider + injects the endpoint as env so the deployed app
// uses Noetica's governed model routing instead of hardcoding a provider.
export interface PorterCompute { broker?: boolean; gpu?: string; gpuCount?: number; vcpus?: number; memGiB?: number; hours?: number; spot?: boolean }
export interface PorterApp {
  version: 'v2'
  name: string
  services: PorterService[]
  build: { method: 'pack' | 'docker'; context: string; dockerfile?: string }
  env?: Record<string, string>
  compute?: PorterCompute
  model?: string
}

const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app')

export function porterApp(opts: { name: string; run?: string; port?: number; method?: 'pack' | 'docker'; context?: string; env?: Record<string, string>; compute?: PorterCompute; model?: string }): PorterApp {
  return {
    version: 'v2',
    name: slug(opts.name),
    services: [{ name: 'web', run: opts.run ?? 'npm start', type: 'web', port: opts.port ?? 3000 }],
    build: { method: opts.method ?? 'pack', context: opts.context ?? './' },
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.compute ? { compute: opts.compute } : {}),
    ...(opts.model ? { model: opts.model } : {}),
  }
}

export interface PorterDeployPlan {
  app: PorterApp
  compute: { brokered: boolean; provider?: string; sku?: string; region?: string; usdPerHour?: number; totalUsd?: number } | null
  model: { id: string; provider: string; baseUrl?: string } | null
  env: Record<string, string>
  commands: ReturnType<typeof porterCommands>
}

/**
 * Resolve a Porter app into a deployable plan: broker the compute to the cheapest cloud (if compute.broker),
 * resolve the model to its provider + endpoint, and inject both as env. This is the integration point that
 * makes a Porter deploy use Noetica's cloud broker + governed model routing.
 */
export async function planPorterDeploy(app: PorterApp): Promise<PorterDeployPlan> {
  const env: Record<string, string> = { ...(app.env ?? {}) }
  let compute: PorterDeployPlan['compute'] = null
  let model: PorterDeployPlan['model'] = null

  if (app.compute?.broker) {
    const { brokerCompute } = await import('./cloud-broker.js')
    const r = brokerCompute({
      hours: app.compute.hours ?? 24, spot: app.compute.spot ?? true, excludeLocal: true,
      vcpus: app.compute.vcpus, memGiB: app.compute.memGiB,
      ...(app.compute.gpu ? { gpu: { type: app.compute.gpu, count: app.compute.gpuCount ?? 1 } } : {}),
    })
    const best = r.best?.sku
    compute = { brokered: true, provider: best?.provider, sku: best?.name, region: best?.region, usdPerHour: r.best?.effectivePerHour, totalUsd: r.best?.totalUsd }
    if (best) { env['NOETICA_CLOUD_PROVIDER'] = best.provider; env['NOETICA_CLOUD_REGION'] = best.region }
  }

  if (app.model) {
    const { resolveProvider } = await import('./router.js')
    const { provider, model: bare, baseUrl } = resolveProvider(app.model)
    model = { id: bare, provider, baseUrl }
    env['NOETICA_MODEL'] = bare
    env['NOETICA_MODEL_PROVIDER'] = provider
    if (baseUrl) env['NOETICA_MODEL_BASE_URL'] = baseUrl
  }

  return { app, compute, model, env, commands: porterCommands(app.name) }
}

/** Porter CLI commands for the local-first dev → deploy loop. */
export function porterCommands(name: string): { devRun: string; apply: string; logs: string; status: string; connect: string } {
  const n = slug(name)
  return {
    devRun: `porter app run ${n} -- <command>`,   // run a command against the app env locally (local-first)
    apply: `porter apply -f porter.yaml`,           // create/update the app from the spec
    logs: `porter app logs ${n}`,
    status: `porter app get ${n}`,
    connect: `porter connect`,                      // link a cluster/registry (one-time)
  }
}

/** Serialize a PorterApp to porter.yaml. */
export function toPorterYaml(app: PorterApp): string {
  const lines = [`version: ${app.version}`, `name: ${app.name}`, 'services:']
  for (const s of app.services) {
    lines.push(`  - name: ${s.name}`, `    run: ${JSON.stringify(s.run)}`, `    type: ${s.type}`)
    if (s.port != null) lines.push(`    port: ${s.port}`)
  }
  lines.push('build:', `  method: ${app.build.method}`, `  context: ${app.build.context}`)
  if (app.build.dockerfile) lines.push(`  dockerfile: ${app.build.dockerfile}`)
  const envKeys = Object.entries(app.env ?? {}).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))   // valid env names only — no YAML injection via crafted keys
  if (envKeys.length) { lines.push('env:'); for (const [k, v] of envKeys) lines.push(`  ${k}: ${JSON.stringify(v)}`) }
  return lines.join('\n') + '\n'
}

export function conformsToPorter(app: Partial<PorterApp>): { conforms: boolean; missing: string[] } {
  const missing: string[] = []
  if (app.version !== 'v2') missing.push('version (must be v2)')
  if (!app.name) missing.push('name')
  if (!app.services?.length) missing.push('services')
  if (!app.build?.method) missing.push('build.method')
  return { conforms: missing.length === 0, missing }
}
