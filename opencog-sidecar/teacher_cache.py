"""
HellGraph Teacher Logit Cache Server.

Runs a whitebox teacher model (HuggingFace transformers) and extracts
per-token logit distributions for a list of prompts.  These logits are then
attached to training pairs so distill_server.py can run full KD loss instead
of falling back to behavioral cloning.

Workflow:
  1. POST /teacher/load { model_id }          — load model into VRAM/RAM
  2. POST /teacher/cache { pairs: [...] }      — run prompts, return annotated pairs
     Each returned pair adds teacher_logits: list[float] (vocabulary distribution
     averaged over sequence positions — suitable for sequence-level KD loss).
  3. POST /distill/pairs via distill_server    — submit annotated pairs
  4. POST /distill/train { teacher_type: "whitebox" }

Configuration (env vars):
  TEACHER_PORT   — listen port       (default: 8140)
  TEACHER_DTYPE  — bfloat16|float16  (default: bfloat16 on CUDA, float32 on CPU)

Run:
  pip install -r requirements-gpu.txt
  uvicorn teacher_cache:app --host 127.0.0.1 --port 8140
"""

from __future__ import annotations

import os
import sys
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Defensive imports ──────────────────────────────────────────────────────────

TORCH_AVAILABLE = False
HF_AVAILABLE = False
_import_errors: list[str] = []

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError as e:
    _import_errors.append(f"torch: {e}")

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore
    HF_AVAILABLE = True
except ImportError as e:
    _import_errors.append(f"transformers: {e}")

# ── State ─────────────────────────────────────────────────────────────────────

_teacher_model: Any = None
_teacher_tokenizer: Any = None
_teacher_model_id: str = ""
_load_error: str = ""

app = FastAPI(title="HellGraph Teacher Cache Server", version="0.1.0")

# ── Models ────────────────────────────────────────────────────────────────────

class LoadRequest(BaseModel):
    model_id: str

class TrainingPairIn(BaseModel):
    prompt: str
    chosen: str
    rejected: str | None = None
    teacher_model: str
    student_model: str
    teacher_logits: list[float] | None = None

class CacheRequest(BaseModel):
    pairs: list[TrainingPairIn]
    max_seq_len: int = 512

# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_loaded() -> tuple[Any, Any]:
    global _teacher_model, _teacher_tokenizer, _load_error
    if _teacher_model is not None and _teacher_tokenizer is not None:
        return _teacher_model, _teacher_tokenizer
    if not (TORCH_AVAILABLE and HF_AVAILABLE):
        raise HTTPException(
            status_code=503,
            detail=f"Missing deps: {', '.join(_import_errors)}. Run: pip install -r requirements-gpu.txt",
        )
    if not _teacher_model_id:
        raise HTTPException(status_code=400, detail="No teacher model loaded. POST /teacher/load first.")
    raise HTTPException(status_code=503, detail=f"Model not loaded: {_load_error or 'call /teacher/load first'}")


def _extract_logits(model: Any, tokenizer: Any, prompt: str, max_seq_len: int) -> list[float]:
    """Run teacher forward pass; return mean vocabulary logit distribution."""
    import torch as _torch
    enc = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=max_seq_len)
    enc = {k: v.to(model.device) for k, v in enc.items()}
    with _torch.no_grad():
        out = model(**enc)
    # out.logits: [1, seq, vocab] — mean over sequence → [vocab]
    logits = out.logits[0].mean(dim=0).float().cpu().tolist()
    return logits

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/teacher/health")
def health() -> dict[str, Any]:
    return {
        "available": TORCH_AVAILABLE and HF_AVAILABLE,
        "model_loaded": _teacher_model is not None,
        "model_id": _teacher_model_id or None,
        "device": str(_teacher_model.device) if _teacher_model is not None else "unloaded",
        "cuda": torch.cuda.is_available() if TORCH_AVAILABLE else False,
        "import_errors": _import_errors or None,
    }


@app.post("/teacher/load")
def load_teacher(req: LoadRequest) -> dict[str, Any]:
    global _teacher_model, _teacher_tokenizer, _teacher_model_id, _load_error
    if not (TORCH_AVAILABLE and HF_AVAILABLE):
        raise HTTPException(
            status_code=503,
            detail=f"Missing deps: {', '.join(_import_errors)}",
        )
    try:
        import torch as _torch
        dtype_env = os.environ.get("TEACHER_DTYPE", "bfloat16")
        dtype = _torch.bfloat16 if (dtype_env == "bfloat16" and _torch.cuda.is_available()) else _torch.float32

        _teacher_tokenizer = AutoTokenizer.from_pretrained(req.model_id)
        _teacher_tokenizer.pad_token = _teacher_tokenizer.eos_token
        _teacher_model = AutoModelForCausalLM.from_pretrained(req.model_id, torch_dtype=dtype)
        _teacher_model.eval()
        _teacher_model_id = req.model_id
        _load_error = ""
        device = "cuda" if _torch.cuda.is_available() else "cpu"
        _teacher_model = _teacher_model.to(device)
        return {"ok": True, "model_id": _teacher_model_id, "device": device}
    except Exception as exc:
        _load_error = f"{type(exc).__name__}: {exc}"
        raise HTTPException(status_code=500, detail=f"Load failed: {_load_error}") from exc


@app.post("/teacher/cache")
def cache_logits(req: CacheRequest) -> dict[str, Any]:
    """Run teacher model on all pairs; annotate with teacher_logits."""
    model, tokenizer = _ensure_loaded()
    annotated: list[dict[str, Any]] = []
    errors: list[str] = []

    for pair in req.pairs:
        try:
            logits = _extract_logits(model, tokenizer, pair.prompt, req.max_seq_len)
            annotated.append({
                **pair.model_dump(),
                "teacher_logits": logits,
                "teacher_model": _teacher_model_id,
            })
        except Exception as exc:
            # Full detail to server logs; expose only the exception class name (no message/trace) externally.
            print(f"teacher annotation failed for pair '{pair.prompt[:60]}': {exc}", file=sys.stderr)
            errors.append(f"pair '{pair.prompt[:60]}': {type(exc).__name__}")
            # Include pair without logits so caller can still use behavioral cloning fallback
            annotated.append({**pair.model_dump(), "teacher_logits": None})

    return {
        "ok": True,
        "annotated": annotated,
        "total": len(annotated),
        "with_logits": sum(1 for p in annotated if p.get("teacher_logits") is not None),
        "errors": errors or None,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TEACHER_PORT", "8140"))
    uvicorn.run(app, host="127.0.0.1", port=port)
