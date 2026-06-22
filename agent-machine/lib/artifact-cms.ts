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

const MAX_VERSIONS = 100
const EXT: Record<ArtifactType, string> = { document: 'md', code: 'txt', evidence: 'json', image: 'bin', data: 'json' }
const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'artifact')

export class ArtifactCMS {
  private index = new Map<string, ArtifactMeta>()
  private seq = 0
  constructor(private store: ContentStore, private now: () => string = () => new Date().toISOString()) {}

  /** Load a persisted index (id → meta). Derives the next seq from the MAX id suffix (not the count) so
   * reloading after deletions can't collide + silently overwrite. Validates shape; skips malformed entries. */
  hydrate(metas: unknown): void {
    if (!Array.isArray(metas)) return
    let maxSeq = 0
    for (const raw of metas) {
      const m = raw as ArtifactMeta
      if (!m || typeof m.id !== 'string' || !Array.isArray(m.versions) || typeof m.currentVersion !== 'number') continue
      this.index.set(m.id, m)
      const n = Number(/-(\d+)$/.exec(m.id)?.[1] ?? 0)
      if (Number.isFinite(n) && n + 1 > maxSeq) maxSeq = n + 1
    }
    this.seq = Math.max(this.seq, maxSeq)
  }
  snapshot(): ArtifactMeta[] { return [...this.index.values()] }

  create(opts: { title: string; type: ArtifactType; content: string; tags?: string[] }): ArtifactMeta {
    const ts = this.now()
    const { hash, size } = this.store.put(opts.content)
    let id = `art-${slug(opts.title)}-${this.seq++}`
    while (this.index.has(id)) id = `art-${slug(opts.title)}-${this.seq++}`   // never overwrite an existing artifact
    const meta: ArtifactMeta = {
      id, title: opts.title, type: opts.type, tags: opts.tags ?? [], createdAt: ts, updatedAt: ts,
      currentVersion: 1, versions: [{ version: 1, hash, size, createdAt: ts }],
    }
    this.index.set(id, meta)
    return meta
  }

  /** New immutable version — content-addressed. Identical content to the current version is a NO-OP (prevents
   * unbounded version growth on repeated saves). Retains at most MAX_VERSIONS (older ones GC'd). */
  update(id: string, content: string, message?: string): ArtifactMeta | null {
    const m = this.index.get(id)
    if (!m) return null
    const { hash, size } = this.store.put(content)
    const cur = m.versions.find((v) => v.version === m.currentVersion)
    if (cur && cur.hash === hash) return m   // identical content → no new version
    const ts = this.now()
    const version = m.currentVersion + 1
    m.versions.push({ version, hash, size, createdAt: ts, message })
    if (m.versions.length > MAX_VERSIONS) m.versions = m.versions.slice(-MAX_VERSIONS)
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
  try {
    const idx = await indexPath()
    if (existsSync(idx)) {
      try { c.hydrate(JSON.parse(readFileSync(idx, 'utf8'))) }
      catch {
        // Corrupt/truncated index (e.g. crash mid-write): DON'T silently wipe — back it up so blobs stay recoverable.
        try { const { renameSync } = await import('node:fs'); renameSync(idx, `${idx}.corrupt-${Date.now()}`) } catch { /* best effort */ }
      }
    }
  } catch { /* fresh */ }
  _prod = c
  return c
}

// Single-flight persistence chain: serializes concurrent writes so two requests can't interleave their bytes
// into the same tmp file (torn JSON) or lost-update each other. Each run serializes the LATEST snapshot.
let _cmsPersistChain: Promise<void> = Promise.resolve()
let _cmsTmpSeq = 0
export function persistArtifactCMS(): Promise<void> {
  _cmsPersistChain = _cmsPersistChain.then(async () => {
    if (!_prod) return
    const { writeFileSync, mkdirSync, renameSync } = await import('node:fs')
    const path = await import('node:path')
    const idx = await indexPath()
    mkdirSync(path.dirname(idx), { recursive: true })
    const tmp = `${idx}.tmp.${process.pid}.${_cmsTmpSeq++}`   // unique tmp → no cross-writer clobber
    writeFileSync(tmp, JSON.stringify(_prod.snapshot()))
    renameSync(tmp, idx)
  }).catch(() => { /* best-effort */ })
  return _cmsPersistChain
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
