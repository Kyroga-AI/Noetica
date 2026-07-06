#!/usr/bin/env python3
"""Noetica local voice sidecar — XTTS-v2 zero-shot voice cloning + text-to-speech.

Started on demand by the agent-machine. Uses only the Python stdlib for the HTTP layer;
the heavy deps (coqui-tts, torch) live in the uv-provisioned venv this script runs under
(system Python is too new for torch). Voices are stored as reference clips under
~/.noetica/voices/<id>/reference.wav so cloning is just "keep the reference + synth from it".

Endpoints:
  GET  /health                                   -> {ok, model_loaded, voices:[...]}
  GET  /voices                                   -> {voices:[{id,name}]}
  POST /clone  {name, audio_b64}                 -> {voice_id}
  POST /tts    {text, voice_id, language?}       -> audio/wav bytes
"""
import os, json, base64, re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VOICES_DIR = os.path.expanduser("~/.noetica/voices")
os.makedirs(VOICES_DIR, exist_ok=True)
PORT = int(os.environ.get("NOETICA_VOICE_PORT", "8124"))
_tts = None
_lock = threading.Lock()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:40] or "voice"


def get_tts():
    """Lazily load XTTS-v2 (heavy: ~2GB model + torch). First call is slow."""
    global _tts
    with _lock:
        if _tts is None:
            from TTS.api import TTS  # coqui-tts
            import torch
            dev = "cpu"
            try:
                if torch.cuda.is_available():
                    dev = "cuda"
                elif torch.backends.mps.is_available():
                    dev = "mps"
            except Exception:
                pass
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
                try:
                    name = json.load(open(mp)).get("name", d)
                except Exception:
                    pass
            out.append({"id": d, "name": name})
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _read(self):
        n = int(self.headers.get("content-length", 0) or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model_loaded": _tts is not None, "voices": list_voices()})
        if self.path == "/voices":
            return self._json(200, {"voices": list_voices()})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        try:
            if self.path == "/clone":
                d = self._read()
                vid = slug(d.get("name", "my voice"))
                # In-scope containment barrier (normpath + startswith on the value used by the
                # sinks below) so a crafted voice id can never escape VOICES_DIR (py/path-injection).
                _base = os.path.realpath(VOICES_DIR)
                vd = os.path.normpath(os.path.join(_base, vid))
                if not vd.startswith(_base + os.sep):
                    return self._json(400, {"error": "invalid voice id"})
                os.makedirs(vd, exist_ok=True)
                raw = base64.b64decode(str(d.get("audio_b64", "")).split(",")[-1])
                if len(raw) < 2000:
                    return self._json(400, {"error": "reference clip too short — record ~6-10 seconds"})
                open(os.path.join(vd, "reference.wav"), "wb").write(raw)
                json.dump({"name": d.get("name", vid)}, open(os.path.join(vd, "meta.json"), "w"))
                return self._json(200, {"voice_id": vid})
            if self.path == "/tts":
                d = self._read()
                vid = slug(d.get("voice_id", ""))
                # In-scope containment barrier before the os.path.exists sink (see /clone).
                _base = os.path.realpath(VOICES_DIR)
                vdir = os.path.normpath(os.path.join(_base, vid))
                if not vdir.startswith(_base + os.sep):
                    return self._json(404, {"error": "voice not found — clone one first"})
                ref = os.path.join(vdir, "reference.wav")
                if not os.path.exists(ref):
                    return self._json(404, {"error": "voice not found — clone one first"})
                out = "/tmp/noetica-voice-out.wav"
                get_tts().tts_to_file(text=str(d.get("text", ""))[:1000], speaker_wav=ref,
                                      language=d.get("language", "en"), file_path=out)
                data = open(out, "rb").read()
                self.send_response(200)
                self.send_header("content-type", "audio/wav")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self._json(404, {"error": "not found"})
        except Exception as e:
            self._json(500, {"error": str(e)})


if __name__ == "__main__":
    print(f"[voice] Noetica voice sidecar listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
