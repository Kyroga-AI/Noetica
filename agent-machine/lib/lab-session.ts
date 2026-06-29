import { AgentSession, Reasoning, RoutePolicy, SessionConfig, OutputSchema, SessionProvider } from './agent-session.js'
import { LabRegistry, LabEndpoint } from './lab-registry.js'
import { embedBatchLocal } from './embed-runtime.js'
import { isSttAvailable, transcribe as sttTranscribe } from './stt.js'
import { runOcr } from './ocr.js'

export class LabSession extends AgentSession {
  private readonly _registry: LabRegistry

  constructor(config: SessionConfig & { _registry?: LabRegistry } = {}) {
    const { _registry, ...sessionConfig } = config
    super(sessionConfig)
    this._registry = _registry ?? new LabRegistry()
  }

  async embed(text: string): Promise<number[] | null> {
    const results = await embedBatchLocal([text])
    if (!results) return null
    return results[0] ?? null
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[] | null> {
    return embedBatchLocal(texts)
  }

  async transcribe(
    audioPath: string,
    opts?: { language?: string },
  ): Promise<{ text: string } | { error: string }> {
    if (isSttAvailable()) {
      return sttTranscribe(audioPath, opts?.language)
    }
    const text = await this.respond(
      `Summarize the transcript of an audio file at: ${audioPath}`,
    )
    return { text: typeof text === 'string' ? text : JSON.stringify(text) }
  }

  async translate(text: string, opts: { from?: string; to: string }): Promise<string> {
    const endpoint = await this._registry.resolve('translation')
    if (endpoint) {
      try {
        const res = await fetch(`${endpoint.url}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, from: opts.from, to: opts.to }),
        })
        if (res.ok) {
          const data = (await res.json()) as { translation?: string; text?: string }
          const out = data.translation ?? data.text
          if (typeof out === 'string') return out
        }
      } catch {
        // sidecar unreachable — fall through to model fallback
      }
    }

    const fromClause = opts.from ? ` from ${opts.from}` : ''
    const result = await this.respond(
      `Translate the following text${fromClause} to ${opts.to}. Return only the translated text, no commentary.\n\n${text}`,
    )
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  async describeImage(imagePath: string): Promise<string> {
    const extracted = await runOcr(imagePath)
    // runOcr returns an error string on failure rather than throwing
    const isError =
      extracted.startsWith('OCR error:') ||
      extracted.startsWith('OCR unavailable') ||
      extracted.startsWith('OCR failed:')

    if (!isError) return extracted

    const result = await this.respond(`Describe what you see in the image at: ${imagePath}`)
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  async labs(): Promise<LabEndpoint[]> {
    return this._registry.discover()
  }
}
