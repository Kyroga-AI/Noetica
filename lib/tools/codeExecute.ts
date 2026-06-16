export interface CodeExecuteResult {
  output: string
  exit_code: number
  runtime_ms: number
  language: string
  files?: Array<{ name: string; base64: string; mimeType: string }>
}

export function formatCodeResult(data: CodeExecuteResult, started?: number): string {
  const runtime = data.runtime_ms ?? (started ? Date.now() - started : 0)
  const header = `[${data.language} · ${runtime}ms · exit ${data.exit_code}]`
  let out = `${header}\n${data.output}`

  if (data.files?.length) {
    for (const f of data.files) {
      if (f.mimeType.startsWith('image/')) {
        out += `\n![${f.name}](data:${f.mimeType};base64,${f.base64})`
      } else {
        out += `\n[File: ${f.name} (${f.mimeType})]`
      }
    }
  }

  return out
}

export async function executeCodeViaApi(
  language: 'python' | 'javascript',
  code: string,
  apiBase = '/api/execute',
  sessionId?: string,
): Promise<string> {
  const started = Date.now()
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language, code, session_id: sessionId }),
  })

  const data = (await res.json()) as CodeExecuteResult & { error?: string }
  if (data.error) return `Error: ${data.error}`

  return formatCodeResult(data, started)
}
