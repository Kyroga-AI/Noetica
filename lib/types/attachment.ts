export type AttachmentKind =
  | 'image'     // png, jpg, gif, webp
  | 'pdf'
  | 'text'      // txt, md, csv, log
  | 'code'      // ts, js, py, rs, go, json, yaml…
  | 'binary'    // anything else

export interface PendingAttachment {
  /** Client-only ID — not persisted to server */
  clientId: string
  name: string
  kind: AttachmentKind
  mimeType: string
  sizeBytes: number
  /** base64-encoded content (data URL stripped) */
  base64: string
  /** human-readable size string */
  sizeLabel: string
}

export function classifyAttachment(name: string, mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift', 'kt', 'json', 'yaml', 'yml', 'toml', 'sql']
  const textExts = ['txt', 'md', 'csv', 'log', 'env', 'sh', 'bash', 'zsh']
  if (codeExts.includes(ext)) return 'code'
  if (textExts.includes(ext) || mime.startsWith('text/')) return 'text'
  return 'binary'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB per file
export const MAX_ATTACHMENTS = 5
