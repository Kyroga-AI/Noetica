/**
 * stt — on-device speech-to-text via whisper.cpp (the `whisper-cli` binary).
 *
 * Cross-platform by design: the SAME whisper.cpp runs on macOS (brew install whisper-cpp) and
 * Linux (apt/build) — chosen over macOS SFSpeechRecognizer precisely so the Linux port is free
 * (SFSpeech also crashes from a CLI). The GGML model is fetched once to ~/.noetica/models.
 * Audio is normalized to 16 kHz mono wav with ffmpeg before transcription.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const MODELS = path.join(os.homedir(), '.noetica', 'models')
// English-only base model is faster + smaller; the multilingual base handles every other language.
const MODEL_EN = { file: path.join(MODELS, 'ggml-base.en.bin'), url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' }
const MODEL_MULTI = { file: path.join(MODELS, 'ggml-base.bin'), url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' }
const modelFor = (lang: string) => (lang.toLowerCase().startsWith('en') ? MODEL_EN : MODEL_MULTI)

// Search PATH dirs PLUS the provisioned voice runtime (~/.noetica/runtime/voice/bin) and the managed runtime,
// so a shipped app that auto-provisioned whisper/ffmpeg finds them without a system install.
const PROVISIONED_BINS = [
  path.join(os.homedir(), '.noetica', 'runtime', 'voice', 'bin'),
  path.join(os.homedir(), '.noetica', 'runtime', 'bin'),
]
function findBin(names: string[]): string | null {
  const dirs = [...PROVISIONED_BINS, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  for (const n of names) for (const d of dirs) { const p = path.join(d, n); if (fs.existsSync(p)) return p }
  for (const n of names) { try { const r = execFileSync('/usr/bin/env', ['sh', '-c', `command -v ${n}`], { encoding: 'utf8' }).trim(); if (r) return r } catch { /* not found */ } }
  return null
}
const whisperBin = (): string | null => findBin(['whisper-cli', 'whisper-cpp', 'whisper', 'main'])
const ffmpegBin = (): string | null => findBin(['ffmpeg'])

export function isSttAvailable(): boolean { return whisperBin() !== null && ffmpegBin() !== null }

const modelReady = new Map<string, Promise<boolean>>()
async function ensureModel(lang: string): Promise<boolean> {
  const m = modelFor(lang)
  if (fs.existsSync(m.file) && fs.statSync(m.file).size > 1e7) return true
  const existing = modelReady.get(m.file); if (existing) return existing
  const p = (async () => {
    try {
      fs.mkdirSync(MODELS, { recursive: true })
      await execFileP('curl', ['-sL', '-o', m.file, m.url], { timeout: 600_000 })
      return fs.existsSync(m.file) && fs.statSync(m.file).size > 1e7
    } catch { return false } finally { modelReady.delete(m.file) }
  })()
  modelReady.set(m.file, p)
  return p
}

/** Transcribe an audio file (any format ffmpeg reads). `language` selects the whisper model + decode hint. */
export async function transcribe(audioPath: string, language = 'en'): Promise<{ text: string } | { error: string }> {
  const w = whisperBin(), f = ffmpegBin()
  if (!w) return { error: 'whisper not installed — `brew install whisper-cpp` (macOS) or build whisper.cpp (Linux).' }
  if (!f) return { error: 'ffmpeg not installed — `brew install ffmpeg` / `apt install ffmpeg`.' }
  const lang = (language || 'en').slice(0, 2).toLowerCase()
  if (!(await ensureModel(lang))) return { error: 'could not fetch the whisper model (network?).' }
  const wav = `${audioPath}.16k.wav`
  try { await execFileP(f, ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', wav], { timeout: 30_000 }) }
  catch (e) { return { error: `audio convert failed: ${e instanceof Error ? e.message : String(e)}` } }
  try {
    const args = ['-m', modelFor(lang).file, '-f', wav, '-nt', '-np']
    if (lang !== 'en') args.push('-l', lang)   // multilingual model: hint the language
    const { stdout } = await execFileP(w, args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
    return { text: stdout.replace(/\s+/g, ' ').trim() }
  } catch (e) {
    return { error: `transcription failed: ${e instanceof Error ? e.message : String(e)}` }
  } finally { try { fs.unlinkSync(wav) } catch { /* */ } }
}
