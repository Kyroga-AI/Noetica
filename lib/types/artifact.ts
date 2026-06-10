export type ArtifactType =
  | 'document'      // markdown / rich text
  | 'code'          // source file with language
  | 'html'          // renderable HTML page
  | 'evidence'      // governance evidence bundle
  | 'data'          // JSON / CSV table
  | 'sourceos_event' // SourceOS interaction event export

export type ArtifactStatus = 'draft' | 'final' | 'archived'

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  language?: string          // for code artifacts: 'typescript', 'python', etc.
  content: string            // raw text / code / html / json
  status: ArtifactStatus
  sessionId?: string         // which workspace session produced this
  messageId?: string         // which assistant message produced this
  createdAt: string
  updatedAt: string
  tags: string[]
  sourceosNodeId?: string
}

export interface ArtifactStore {
  artifacts: Record<string, Artifact>
  version: number
}

export const ARTIFACT_STORE_VERSION = 1
export const ARTIFACT_STORE_KEY = 'noetica:artifacts'

// ─── Language display helpers ─────────────────────────────────────────────────

export const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  sql: 'SQL',
  bash: 'Bash',
  json: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  other: 'Other',
}

export function artifactTypeLabel(type: ArtifactType): string {
  const labels: Record<ArtifactType, string> = {
    document: 'Document',
    code: 'Code',
    html: 'HTML page',
    evidence: 'Evidence bundle',
    data: 'Data',
    sourceos_event: 'SourceOS event',
  }
  return labels[type] ?? type
}

export function artifactTypeIcon(type: ArtifactType): string {
  const icons: Record<ArtifactType, string> = {
    document: '📄',
    code: '⌥',
    html: '🌐',
    evidence: '🛡',
    data: '⊞',
    sourceos_event: '⬡',
  }
  return icons[type] ?? '📄'
}
