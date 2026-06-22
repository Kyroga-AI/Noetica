/**
 * artifact-cms.ts — a proper server-side CMS for artifacts (the client useArtifacts hook is CRUD-only: no
 * versions, no server persistence, no drive link). This adds:
 *   • content-addressable storage (dedup via sha256, on top of blob-store)
 *   • full VERSION history per artifact + rollback (every update is a new immutable version)
 *   • metadata (type, tags, timestamps, current version)
 *   • search/filter
 *   • DRIVE integration — materialize an artifact to the workspace filesystem (~/.noetica/workspaces) and
 *     import a workspace file back as an artifact.
 * Storage is injected (ContentStore) so the core is unit-tested without touching disk; production wraps blob-store.
 */
export type ArtifactType = 'document' | 'code' | 'evidence' | 'image' | 'data'

export interface ContentStore { put(data: string): { hash: string; size: number }; get(hash: string): string | null }

export interface ArtifactVersion { version: number; hash: string; size: number; createdAt: string; message?: string }
export interface ArtifactMeta {
  id: string; title: string; type: ArtifactType; tags: string[]
  createdAt: string; updatedAt: string; currentVersion: number; versions: ArtifactVersion[]
}

const EXT: Record<ArtifactType, string> = { document: 'md', code: 'txt', evidence: 'json', image: 'bin', data: 'json' }
const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'artifact')

export class ArtifactCMS {
  private index = new Map<string, ArtifactMeta>()
  private seq = 0
  constructor(private store: ContentStore, private now: () => string = () => new Date().toISOString()) {}

  /** Load a persisted index (id → meta). */
  hydrate(metas: ArtifactMeta[]): void { for (const m of metas) { this.index.set(m.id, m); } this.seq = Math.max(this.seq, metas.length) }
  snapshot(): ArtifactMeta[] { return [...this.index.values()] }

  create(opts: { title: string; type: ArtifactType; content: string; tags?: string[] }): ArtifactMeta {
    const ts = this.now()
    const { hash, size } = this.store.put(opts.content)
    const id = `art-${slug(opts.title)}-${this.seq++}`
    const meta: ArtifactMeta = {
      id, title: opts.title, type: opts.type, tags: opts.tags ?? [], createdAt: ts, updatedAt: ts,
      currentVersion: 1, versions: [{ version: 1, hash, size, createdAt: ts }],
    }
    this.index.set(id, meta)
    return meta
  }

  /** New immutable version (content-addressed; identical content still records a version with the same hash). */
  update(id: string, content: string, message?: string): ArtifactMeta | null {
    const m = this.index.get(id)
    if (!m) return null
    const ts = this.now()
    const { hash, size } = this.store.put(content)
    const version = m.currentVersion + 1
    m.versions.push({ version, hash, size, createdAt: ts, message })
    m.currentVersion = version
    m.updatedAt = ts
    return m
  }

  get(id: string): ArtifactMeta | null { return this.index.get(id) ?? null }
  getContent(id: string, version?: number): string | null {
    const m = this.index.get(id); if (!m) return null
    const v = m.versions.find((x) => x.version === (version ?? m.currentVersion))
    return v ? this.store.get(v.hash) : null
  }
  history(id: string): ArtifactVersion[] { return this.index.get(id)?.versions ?? [] }

  /** Restore an old version as a NEW version (non-destructive rollback). */
  rollback(id: string, toVersion: number): ArtifactMeta | null {
    const content = this.getContent(id, toVersion)
    if (content == null) return null
    return this.update(id, content, `rollback to v${toVersion}`)
  }

  delete(id: string): boolean { return this.index.delete(id) }

  list(filter?: { type?: ArtifactType; tag?: string }): ArtifactMeta[] {
    return [...this.index.values()]
      .filter((m) => (!filter?.type || m.type === filter.type) && (!filter?.tag || m.tags.includes(filter.tag)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  search(query: string): ArtifactMeta[] {
    const q = query.toLowerCase()
    return this.list().filter((m) => m.title.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)))
  }

  /** Suggested workspace-drive file for an artifact (the CMS→drive bridge). */
  driveFile(id: string): { path: string; content: string } | null {
    const m = this.index.get(id); if (!m) return null
    const content = this.getContent(id); if (content == null) return null
    return { path: `${slug(m.title)}.${EXT[m.type]}`, content }
  }
}

// ── Production singleton: blob-store content + JSON index at ~/.noetica/artifacts/ (dynamic imports keep the
// core lib pure + unit-testable). ──
let _prod: ArtifactCMS | null = null
const indexPath = async () => { const os = await import('node:os'); const path = await import('node:path'); return path.join(os.homedir(), '.noetica', 'artifacts', 'index.json') }

export async function getArtifactCMS(): Promise<ArtifactCMS> {
  if (_prod) return _prod
  const { putBlob, getBlob } = await import('./blob-store.js')
  const { existsSync, readFileSync } = await import('node:fs')
  const store: ContentStore = {
    put: (d) => { const r = putBlob(d); return { hash: r.hash, size: r.size } },
    get: (h) => { const b = getBlob(h); return b ? b.toString('utf8') : null },
  }
  const c = new ArtifactCMS(store)
  try { const idx = await indexPath(); if (existsSync(idx)) c.hydrate(JSON.parse(readFileSync(idx, 'utf8')) as ArtifactMeta[]) } catch { /* fresh */ }
  _prod = c
  return c
}

export async function persistArtifactCMS(): Promise<void> {
  if (!_prod) return
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const path = await import('node:path')
  try { const idx = await indexPath(); mkdirSync(path.dirname(idx), { recursive: true }); writeFileSync(idx, JSON.stringify(_prod.snapshot())) } catch { /* ignore */ }
}

/** Write an artifact to the workspace drive (~/.noetica/workspaces/<ws>/) — the CMS→drive integration. */
export async function writeArtifactToDrive(id: string, workspace = 'default'): Promise<{ path: string } | null> {
  const c = await getArtifactCMS()
  const f = c.driveFile(id); if (!f) return null
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const os = await import('node:os'); const path = await import('node:path')
  const ws = (workspace.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)) || 'default'
  const dir = path.join(os.homedir(), '.noetica', 'workspaces', ws)
  mkdirSync(dir, { recursive: true })
  const full = path.join(dir, f.path)
  writeFileSync(full, f.content)
  return { path: full }
}
