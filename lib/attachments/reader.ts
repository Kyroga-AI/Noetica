import type { PendingAttachment } from '@/lib/types/attachment'
import { classifyAttachment, formatSize, MAX_ATTACHMENT_BYTES } from '@/lib/types/attachment'
import { isTauri } from '@/lib/tauri/bridge'

// ─── Browser file input → PendingAttachment ───────────────────────────────────

export function readFileAsAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error(`${file.name} exceeds 10 MB limit`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      // Strip the data URL prefix — keep only the base64 payload
      const base64 = dataUrl.split(',')[1] ?? ''
      resolve({
        clientId: crypto.randomUUID(),
        name: file.name,
        kind: classifyAttachment(file.name, file.type),
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        base64,
        sizeLabel: formatSize(file.size),
      })
    }
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export async function readFilesAsAttachments(files: FileList | File[]): Promise<{ ok: PendingAttachment[]; errors: string[] }> {
  const ok: PendingAttachment[] = []
  const errors: string[] = []
  for (const f of Array.from(files)) {
    try {
      ok.push(await readFileAsAttachment(f))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { ok, errors }
}

// ─── Tauri native file picker ─────────────────────────────────────────────────

export async function openNativeFilePicker(): Promise<PendingAttachment[]> {
  if (!isTauri()) return []
  try {
    // eslint-disable-next-line
    const mod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-dialog' as string)
    // eslint-disable-next-line
    const paths: string[] | null = await mod.open({
      multiple: true,
      filters: [
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'csv'] },
        { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'json', 'yaml', 'toml', 'sql'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (!paths || paths.length === 0) return []

    // eslint-disable-next-line
    const fsMod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-fs' as string)
    const results: PendingAttachment[] = []
    for (const path of paths) {
      try {
        // eslint-disable-next-line
        const bytes: Uint8Array = await fsMod.readFile(path)
        const name = path.split('/').pop() ?? path
        const mimeType = guessMime(name)
        // Convert to base64
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        results.push({
          clientId: crypto.randomUUID(),
          name,
          kind: classifyAttachment(name, mimeType),
          mimeType,
          sizeBytes: bytes.length,
          base64,
          sizeLabel: formatSize(bytes.length),
        })
      } catch { /* skip unreadable */ }
    }
    return results
  } catch {
    return []
  }
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain',
    ts: 'text/typescript', tsx: 'text/typescript', js: 'text/javascript', jsx: 'text/javascript',
    py: 'text/x-python', rs: 'text/x-rust', go: 'text/x-go', sql: 'text/x-sql',
  }
  return map[ext] ?? 'application/octet-stream'
}
