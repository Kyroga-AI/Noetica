/**
 * porter-paas.ts — integrate Noetica with Porter (porter.run) for local-first development → deploy. Noetica
 * scaffolds + builds projects in ~/.noetica/workspaces; Porter takes those to a dev/prod environment with a
 * declarative app spec (porter.yaml v2). This generates the spec + the CLI commands (local run, apply, logs)
 * so a Noetica project becomes Porter-deployable without leaving the app. Local-first: `porter app run` runs
 * against the app's env locally before any cloud deploy.
 */
export interface PorterService { name: string; run: string; type: 'web' | 'worker' | 'job'; port?: number }
export interface PorterApp {
  version: 'v2'
  name: string
  services: PorterService[]
  build: { method: 'pack' | 'docker'; context: string; dockerfile?: string }
  env?: Record<string, string>
}

const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app')

export function porterApp(opts: { name: string; run?: string; port?: number; method?: 'pack' | 'docker'; context?: string; env?: Record<string, string> }): PorterApp {
  return {
    version: 'v2',
    name: slug(opts.name),
    services: [{ name: 'web', run: opts.run ?? 'npm start', type: 'web', port: opts.port ?? 3000 }],
    build: { method: opts.method ?? 'pack', context: opts.context ?? './' },
    ...(opts.env ? { env: opts.env } : {}),
  }
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
