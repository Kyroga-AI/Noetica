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
const MODEL_FILE = path.join(MODELS, 'ggml-base.en.bin')
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'

function findBin(names: string[]): string | null {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  for (const n of names) for (const d of dirs) { const p = path.join(d, n); if (fs.existsSync(p)) return p }
  for (const n of names) { try { const r = execFileSync('/usr/bin/env', ['sh', '-c', `command -v ${n}`], { encoding: 'utf8' }).trim(); if (r) return r } catch { /* not found */ } }
  return null
}
const whisperBin = (): string | null => findBin(['whisper-cli', 'whisper-cpp', 'whisper', 'main'])
const ffmpegBin = (): string | null => findBin(['ffmpeg'])

export function isSttAvailable(): boolean { return whisperBin() !== null && ffmpegBin() !== null }

let modelReady: Promise<boolean> | null = null
async function ensureModel(): Promise<boolean> {
  if (fs.existsSync(MODEL_FILE) && fs.statSync(MODEL_FILE).size > 1e7) return true
  if (modelReady) return modelReady
  modelReady = (async () => {
    try {
      fs.mkdirSync(MODELS, { recursive: true })
      await execFileP('curl', ['-sL', '-o', MODEL_FILE, MODEL_URL], { timeout: 600_000 })
      return fs.existsSync(MODEL_FILE) && fs.statSync(MODEL_FILE).size > 1e7
    } catch { return false } finally { modelReady = null }
  })()
  return modelReady
}

/** Transcribe an audio file (any format ffmpeg reads). Returns text or an error string. */
export async function transcribe(audioPath: string): Promise<{ text: string } | { error: string }> {
  const w = whisperBin(), f = ffmpegBin()
  if (!w) return { error: 'whisper not installed — `brew install whisper-cpp` (macOS) or build whisper.cpp (Linux).' }
  if (!f) return { error: 'ffmpeg not installed — `brew install ffmpeg` / `apt install ffmpeg`.' }
  if (!(await ensureModel())) return { error: 'could not fetch the whisper model (network?).' }
  const wav = `${audioPath}.16k.wav`
  try { await execFileP(f, ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', wav], { timeout: 30_000 }) }
  catch (e) { return { error: `audio convert failed: ${e instanceof Error ? e.message : String(e)}` } }
  try {
    const { stdout } = await execFileP(w, ['-m', MODEL_FILE, '-f', wav, '-nt', '-np'], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
    return { text: stdout.replace(/\s+/g, ' ').trim() }
  } catch (e) {
    return { error: `transcription failed: ${e instanceof Error ? e.message : String(e)}` }
  } finally { try { fs.unlinkSync(wav) } catch { /* */ } }
}
