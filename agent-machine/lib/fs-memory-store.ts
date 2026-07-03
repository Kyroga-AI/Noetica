/**
 * fs-memory-store.ts — a filesystem MemoryStore for the Claude-pattern layered memory.
 *
 * Realizes the living-KB on disk (Karpathy pattern), matching how Claude Code's own memory is laid out:
 *   L1  <root>/MEMORY.md          — the always-loaded index (one pointer line per topic)
 *   L2  <root>/topics/<name>.md   — on-demand topic docs, frontmatter (links/score/provenance) + body
 *   L3  <root>/transcripts/log.jsonl — append-only, grep-only
 *
 * A `namespace` scopes the root (e.g. local vs shared) — the seam the isolation model plugs into later.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { MemoryStore, MemoryPointer, TopicDoc } from './memory-layers.js'

export function memoryRoot(namespace = 'default'): string {
  const base = process.env.NOETICA_MEMORY_DIR || path.join(os.homedir(), '.noetica', 'memory')
  return namespace === 'default' ? base : path.join(base, namespace)
}

const safeName = (name: string) => name.replace(/[^\w.-]/g, '_').replace(/^\.+/, '_')

// ── topic (.md) serialize / parse ──
function serializeTopic(d: TopicDoc): string {
  const fm = ['---', `name: ${d.name}`, `updatedAt: ${d.updatedAt}`]
  if (d.score != null) fm.push(`score: ${d.score}`)
  if (d.provenance) fm.push(`provenance: ${d.provenance}`)
  fm.push(`links: [${d.links.join(', ')}]`, '---', '')
  return fm.join('\n') + (d.body.endsWith('\n') ? d.body : d.body + '\n')
}

function parseTopic(fallbackName: string, raw: string): TopicDoc {
  let body = raw
  const meta: Record<string, string> = {}
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (m) {
    body = raw.slice(m[0].length)
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv) meta[kv[1]] = kv[2]
    }
  }
  const fmLinks = (meta.links ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  // living-KB: also treat [[name]] wikilinks in the body as backlinks
  const bodyLinks = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1].trim())
  return {
    name: meta.name || fallbackName,
    body,
    links: [...new Set([...fmLinks, ...bodyLinks])],
    score: meta.score != null ? Number(meta.score) : undefined,
    provenance: meta.provenance || undefined,
    updatedAt: meta.updatedAt != null ? Number(meta.updatedAt) : 0,
  }
}

const firstLine = (s: string) => (s.split('\n').find((l) => l.trim()) ?? '').slice(0, 140)

export function fsMemoryStore(namespace = 'default'): MemoryStore {
  const root = memoryRoot(namespace)
  const topicsDir = path.join(root, 'topics')
  const transcript = path.join(root, 'transcripts', 'log.jsonl')
  const indexFile = path.join(root, 'MEMORY.md')
  const topicPath = (name: string) => path.join(topicsDir, `${safeName(name)}.md`)

  const ensure = async () => {
    await fs.mkdir(topicsDir, { recursive: true })
    await fs.mkdir(path.dirname(transcript), { recursive: true })
  }

  return {
    async readIndex(): Promise<MemoryPointer[]> {
      const raw = await fs.readFile(indexFile, 'utf8').catch(() => '')
      const ptrs: MemoryPointer[] = []
      for (const line of raw.split('\n')) {
        const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\)\s*—\s*(.*)$/)
        if (m) ptrs.push({ name: m[1], topic: m[2], hook: m[3] })
      }
      return ptrs
    },
    async writeIndex(ptrs: MemoryPointer[]): Promise<void> {
      await ensure()
      const body = '# Memory Index\n' + ptrs.map((p) => `- [${p.name}](${p.topic}) — ${p.hook}`).join('\n') + '\n'
      await fs.writeFile(indexFile, body)
    },
    async listTopics(): Promise<string[]> {
      const files = await fs.readdir(topicsDir).catch(() => [] as string[])
      return files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
    },
    async readTopic(name: string): Promise<TopicDoc | null> {
      const raw = await fs.readFile(topicPath(name), 'utf8').catch(() => null)
      return raw == null ? null : parseTopic(safeName(name), raw)
    },
    async writeTopic(doc: TopicDoc): Promise<void> {
      await ensure()
      await fs.writeFile(topicPath(doc.name), serializeTopic(doc))
    },
    async deleteTopic(name: string): Promise<void> {
      await fs.rm(topicPath(name), { force: true })
    },
    async grepTranscripts(query: string): Promise<string[]> {
      const raw = await fs.readFile(transcript, 'utf8').catch(() => '')
      return raw.split('\n').filter((l) => l && l.includes(query))
    },
    async appendTranscript(line: string): Promise<void> {
      await ensure()
      await fs.appendFile(transcript, line.replace(/\n/g, ' ') + '\n')
    },
  }
}

export { firstLine as _firstLine }
