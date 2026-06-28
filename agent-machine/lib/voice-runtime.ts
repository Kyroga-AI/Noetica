/**
 * voice-runtime — manages the local XTTS-v2 voice sidecar (zero-shot voice cloning + TTS).
 *
 * The sidecar runs under an isolated uv-provisioned Python 3.11 venv (the system Python is
 * too new for torch). It's lazy-spawned on first use and proxied to from the /api/voice/*
 * routes. The sidecar source is embedded here and written to ~/.noetica/voice on demand so
 * it works in the bun-compiled binary too (where scripts/ isn't on disk). The canonical,
 * readable copy lives in scripts/voice-sidecar.py — keep them in sync.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

export const VOICE_DIR = path.join(os.homedir(), '.noetica', 'voice')
const VENV_PY = path.join(VOICE_DIR, 'venv', 'bin', 'python')
const SIDECAR_PY = path.join(VOICE_DIR, 'voice-sidecar.py')
const PORT = 8124
const BASE = `http://127.0.0.1:${PORT}`
let child: ChildProcess | null = null

// Embedded sidecar (mirror of scripts/voice-sidecar.py). No ${...} so it's template-safe.
const SIDECAR_SRC = `import os, json, base64, re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
VOICES_DIR = os.path.expanduser("~/.noetica/voices")
os.makedirs(VOICES_DIR, exist_ok=True)
PORT = int(os.environ.get("NOETICA_VOICE_PORT", "8124"))
_tts = None
_lock = threading.Lock()
def slug(s): return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:40] or "voice"
def get_tts():
    global _tts
    with _lock:
        if _tts is None:
            from TTS.api import TTS
            import torch
            dev = "cpu"
            try:
                if torch.cuda.is_available(): dev = "cuda"
                elif torch.backends.mps.is_available(): dev = "mps"
            except Exception: pass
            _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False).to(dev)
    return _tts
def list_voices():
    out = []
    for d in sorted(os.listdir(VOICES_DIR)):
        p = os.path.join(VOICES_DIR, d)
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "reference.wav")):
            name = d
            mp = os.path.join(p, "meta.json")
            if os.path.exists(mp):
                try: name = json.load(open(mp)).get("name", d)
                except Exception: pass
            out.append({"id": d, "name": name})
    return out
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code)
        self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def _read(self):
        n = int(self.headers.get("content-length", 0) or 0); return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        if self.path == "/health": return self._json(200, {"ok": True, "model_loaded": _tts is not None, "voices": list_voices()})
        if self.path == "/voices": return self._json(200, {"voices": list_voices()})
        self._json(404, {"error": "not found"})
    def do_POST(self):
        try:
            if self.path == "/clone":
                d = self._read(); vid = slug(d.get("name", "my voice"))
                vd = os.path.join(VOICES_DIR, vid); os.makedirs(vd, exist_ok=True)
                raw = base64.b64decode(str(d.get("audio_b64", "")).split(",")[-1])
                if len(raw) < 2000: return self._json(400, {"error": "reference clip too short"})
                open(os.path.join(vd, "reference.wav"), "wb").write(raw)
                json.dump({"name": d.get("name", vid)}, open(os.path.join(vd, "meta.json"), "w"))
                return self._json(200, {"voice_id": vid})
            if self.path == "/tts":
                d = self._read(); ref = os.path.join(VOICES_DIR, slug(d.get("voice_id", "")), "reference.wav")
                if not os.path.exists(ref): return self._json(404, {"error": "voice not found"})
                out = "/tmp/noetica-voice-out.wav"
                get_tts().tts_to_file(text=str(d.get("text", ""))[:1000], speaker_wav=ref, language=d.get("language", "en"), file_path=out)
                data = open(out, "rb").read(); self.send_response(200)
                self.send_header("content-type", "audio/wav"); self.send_header("content-length", str(len(data)))
                self.end_headers(); self.wfile.write(data); return
            self._json(404, {"error": "not found"})
        except Exception as e:
            self._json(500, {"error": str(e)})
if __name__ == "__main__":
    print("[voice] sidecar on 127.0.0.1:" + str(PORT), flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
`

export function isVoiceProvisioned(): boolean {
  try { return fs.existsSync(VENV_PY) } catch { return false }
}

async function sidecarHealthy(): Promise<boolean> {
  try { const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
}

/** Lazy-start the sidecar (writing its source first). Returns false if not provisioned. */
export async function ensureVoiceSidecar(): Promise<boolean> {
  if (!isVoiceProvisioned()) return false
  if (await sidecarHealthy()) return true
  try {
    fs.mkdirSync(VOICE_DIR, { recursive: true })
    fs.writeFileSync(SIDECAR_PY, SIDECAR_SRC)
  } catch { return false }
  if (!child || child.exitCode !== null) {
    child = spawn(VENV_PY, [SIDECAR_PY], { env: { ...process.env, NOETICA_VOICE_PORT: String(PORT), COQUI_TOS_AGREED: '1' }, stdio: 'ignore', detached: false })
    child.on('exit', () => { child = null })
  }
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await sidecarHealthy()) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

export function voiceFetch(p: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${p}`, init)
}

// ─── In-app provisioning (P4.12) ────────────────────────────────────────────────────────────────────────
// Installed-app users don't have the repo, so we run the provisioning STEPS inline (uv venv + coqui-tts) rather
// than spawning scripts/provision-voice.sh. Background + status-polled. Requires `uv` on PATH (brew install uv).
let _provision: { running: boolean; done: boolean; step: string; error: string } = { running: false, done: false, step: '', error: '' }
export function voiceProvisionStatus(): { provisioned: boolean; running: boolean; done: boolean; step: string; error: string } {
  return { provisioned: isVoiceProvisioned(), ..._provision }
}
export function provisionVoice(): { started: boolean; reason?: string } {
  if (isVoiceProvisioned()) return { started: false, reason: 'already provisioned' }
  if (_provision.running) return { started: false, reason: 'already running' }
  _provision = { running: true, done: false, step: 'starting', error: '' }
  const run = (cmd: string, args: string[]): Promise<number> => new Promise((resolve) => {
    const p = spawn(cmd, args, { env: process.env, stdio: 'ignore' })
    p.on('exit', (code) => resolve(code ?? 1)); p.on('error', () => resolve(127))
  })
  void (async () => {
    try {
      fs.mkdirSync(VOICE_DIR, { recursive: true })
      if ((await run('/usr/bin/env', ['uv', '--version'])) !== 0) { _provision = { running: false, done: false, step: '', error: 'uv not found — run `brew install uv`, then retry' }; return }
      void run('/usr/bin/env', ['brew', 'install', 'ffmpeg'])   // best-effort audio I/O; non-blocking
      _provision.step = 'creating isolated Python 3.11 venv'
      if ((await run('/usr/bin/env', ['uv', 'venv', path.join(VOICE_DIR, 'venv'), '--python', '3.11'])) !== 0) { _provision = { running: false, done: false, step: '', error: 'venv creation failed (is Python 3.11 available to uv?)' }; return }
      _provision.step = 'installing coqui-tts (downloads torch — several GB)'
      if ((await run('/usr/bin/env', ['uv', 'pip', 'install', '--python', VENV_PY, 'coqui-tts'])) !== 0) { _provision = { running: false, done: false, step: '', error: 'coqui-tts install failed' }; return }
      _provision = { running: false, done: true, step: 'done', error: '' }
    } catch (e) { _provision = { running: false, done: false, step: '', error: e instanceof Error ? e.message : 'provisioning failed' } }
  })()
  return { started: true }
}
