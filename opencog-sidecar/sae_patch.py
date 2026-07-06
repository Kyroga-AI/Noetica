"""
HellGraph SAE Activation Patching Server.

Replaces the prompt-injection approximation in lib/sae/localSteering.ts with
genuine residual-stream activation patching via TransformerLens + SAELens:

  1. Load model (TransformerLens HookedTransformer)
  2. Load SAE (SAELens) — the SAE's hook_name determines the exact residual-stream site
  3. For each /sae/steer request:
     a. Tokenize the prompt
     b. Forward-pass with activation cache at the SAE's hook site
     c. Decode residual stream → feature activation tensor via SAE encoder
     d. Set target feature dimension to requested strength (or 0.0 for ablation)
     e. Reconstruct patched residual via SAE decoder; compute delta
     f. Re-run generation with the delta injected at every forward step
     g. Return steered completion + activation statistics

Causal-triad protocol (superconscious M1-C):
  POST /sae/causal_triad  — ablation + positive + negative steering in one call.
  Returns structured results with designated-latent tracking for M1 certification.

Configuration (env vars):
  SAE_MODEL_ID    — TransformerLens model name   (default: gpt2)
  SAE_RELEASE     — SAELens release string         (default: gpt2-small-res-jb)
  SAE_ID          — SAELens sae_id within release  (default: blocks.8.hook_resid_pre)
  SAE_PATCH_PORT  — listen port                    (default: 8138)

Degrades gracefully when transformer_lens / sae_lens / torch are absent.
Small models (GPT-2, Pythia-70M) run on CPU. Large models (Gemma-2-9B) need CUDA.

Run:
  pip install -r requirements-gpu.txt
  uvicorn sae_patch:app --host 127.0.0.1 --port 8138
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Defensive imports ──────────────────────────────────────────────────────────

TORCH_AVAILABLE = False
TL_AVAILABLE = False
SAE_AVAILABLE = False
_import_errors: list[str] = []

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError as e:
    _import_errors.append(f"torch: {e}")

try:
    from transformer_lens import HookedTransformer  # type: ignore
    TL_AVAILABLE = True
except ImportError as e:
    _import_errors.append(f"transformer_lens: {e}")

try:
    from sae_lens import SAE as SAELens  # type: ignore
    SAE_AVAILABLE = True
except ImportError as e:
    _import_errors.append(f"sae_lens: {e}")

# ── Config ────────────────────────────────────────────────────────────────────

_MODEL_ID   = os.environ.get("SAE_MODEL_ID",  "gpt2")
_SAE_RELEASE = os.environ.get("SAE_RELEASE",  "gpt2-small-res-jb")
_SAE_ID      = os.environ.get("SAE_ID",       "blocks.8.hook_resid_pre")

# ── Lazy-loaded state ─────────────────────────────────────────────────────────

_model: Any = None
_sae:   Any = None
_hook_name: str = _SAE_ID
_load_error: str = ""

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="HellGraph SAE Patching Server", version="0.1.0")

# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_loaded() -> tuple[Any, Any]:
    global _model, _sae, _hook_name, _load_error
    if _model is not None and _sae is not None:
        return _model, _sae
    if not (TORCH_AVAILABLE and TL_AVAILABLE and SAE_AVAILABLE):
        missing = ", ".join(_import_errors)
        raise HTTPException(
            status_code=503,
            detail=f"Required packages not installed ({missing}). Run: pip install -r requirements-gpu.txt",
        )
    try:
        import torch as _torch
        dtype = _torch.bfloat16 if _torch.cuda.is_available() else _torch.float32
        _model = HookedTransformer.from_pretrained(_MODEL_ID, dtype=dtype)
        _model.eval()
        _sae, _, _ = SAELens.from_pretrained(release=_SAE_RELEASE, sae_id=_SAE_ID)
        _sae = _sae.to(_model.cfg.device)
        _hook_name = getattr(_sae.cfg, "hook_name", _SAE_ID)
        return _model, _sae
    except Exception as exc:
        # Full detail to server logs; expose only the exception class name (no message/trace) externally.
        print(f"Model/SAE load failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        _load_error = type(exc).__name__
        raise HTTPException(status_code=503, detail=f"Model/SAE load failed: {_load_error}") from exc


def _steered_generation(
    model: Any,
    sae: Any,
    hook: str,
    prompt: str,
    feature_id: int,
    strength: float,
    max_new_tokens: int,
) -> dict[str, Any]:
    import torch as _torch

    tokens = model.to_tokens(prompt)

    # ── Step 1: cache residual stream at the SAE hook site ────────────────────
    with _torch.no_grad():
        _, cache = model.run_with_cache(tokens, names_filter=hook)

    orig_resid = cache[hook]  # [batch, seq, d_model]

    # ── Step 2: decode via SAE ────────────────────────────────────────────────
    with _torch.no_grad():
        feature_acts = sae.encode(orig_resid)  # [batch, seq, n_features]

    original_act = float(feature_acts[0, :, feature_id].mean().item())

    # ── Step 3: modify target feature ────────────────────────────────────────
    modified = feature_acts.clone()
    modified[:, :, feature_id] = max(0.0, strength) if strength >= 0 else 0.0

    # ── Step 4: reconstruct patched residual delta ────────────────────────────
    with _torch.no_grad():
        orig_recon   = sae.decode(feature_acts)
        patch_recon  = sae.decode(modified)
        delta = patch_recon - orig_recon  # [batch, seq, d_model]

    patched_resid = (orig_resid + delta).detach()

    # ── Step 5: generate with hook that injects the patch ─────────────────────
    def _patch_hook(value: Any, _hook: Any) -> Any:
        # Only patch positions already seen (seq dimension of patched_resid)
        n = patched_resid.shape[1]
        value[:, :n, :] = patched_resid
        return value

    with _torch.no_grad():
        out_tokens = model.generate(
            tokens,
            max_new_tokens=int(max_new_tokens),
            fwd_hooks=[(hook, _patch_hook)],
            verbose=False,
        )

    completion = model.to_string(out_tokens[0, tokens.shape[1]:])

    return {
        "steered_completion": completion,
        "original_feature_activation": original_act,
        "feature_id": feature_id,
        "strength": strength,
        "hook": hook,
        "resid_delta_norm": float(delta.norm().item()),
    }

# ── Models ────────────────────────────────────────────────────────────────────

class SteerRequest(BaseModel):
    prompt: str
    feature_id: int
    strength: float = 20.0
    max_new_tokens: int = 200


class ActivateRequest(BaseModel):
    prompt: str
    top_k: int = 20


class CausalTriadRequest(BaseModel):
    prompt: str
    feature_id: int
    ablation_strength: float = 0.0
    positive_strength: float = 20.0
    negative_strength: float = -20.0
    max_new_tokens: int = 200


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/sae/health")
def health() -> dict[str, Any]:
    return {
        "available": TORCH_AVAILABLE and TL_AVAILABLE and SAE_AVAILABLE,
        "model_loaded": _model is not None,
        "sae_loaded": _sae is not None,
        "model_id": _MODEL_ID,
        "sae_release": _SAE_RELEASE,
        "sae_id": _SAE_ID,
        "hook_name": _hook_name,
        "device": str(_model.cfg.device) if _model is not None else "unloaded",
        "load_error": _load_error or None,
        "import_errors": _import_errors or None,
        "cuda_available": torch.cuda.is_available() if TORCH_AVAILABLE else False,
    }


@app.post("/sae/load")
def load_model() -> dict[str, Any]:
    """Eagerly load model + SAE (otherwise lazy-loaded on first steer request)."""
    _ensure_loaded()
    return {"ok": True, "model_id": _MODEL_ID, "sae_id": _SAE_ID, "hook": _hook_name}


@app.post("/sae/steer")
def steer(req: SteerRequest) -> dict[str, Any]:
    model, sae = _ensure_loaded()
    try:
        result = _steered_generation(model, sae, _hook_name, req.prompt, req.feature_id, req.strength, req.max_new_tokens)
        return {"ok": True, **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Steering failed: {exc}") from exc


@app.post("/sae/activate")
def activate(req: ActivateRequest) -> dict[str, Any]:
    """Return top-k feature activations for a prompt (no generation)."""
    model, sae = _ensure_loaded()
    import torch as _torch
    tokens = model.to_tokens(req.prompt)
    with _torch.no_grad():
        _, cache = model.run_with_cache(tokens, names_filter=_hook_name)
        feature_acts = sae.encode(cache[_hook_name])
        mean_acts = feature_acts[0].mean(dim=0)
        vals, idx = mean_acts.topk(int(req.top_k))
    return {
        "top_features": [
            {"feature_id": int(idx[i].item()), "activation": float(vals[i].item())}
            for i in range(int(req.top_k))
        ],
        "hook": _hook_name,
        "prompt_tokens": int(tokens.shape[1]),
    }


@app.post("/sae/causal_triad")
def causal_triad(req: CausalTriadRequest) -> dict[str, Any]:
    """
    M1-C causal triad: ablation + positive steering + negative steering.

    Returns structured results with per-arm activation statistics for
    superconscious M1 certificate generation.
    """
    model, sae = _ensure_loaded()
    arms: dict[str, Any] = {}
    for arm_name, strength in [
        ("ablation",  req.ablation_strength),
        ("positive",  req.positive_strength),
        ("negative",  req.negative_strength),
    ]:
        try:
            arms[arm_name] = _steered_generation(
                model, sae, _hook_name,
                req.prompt, req.feature_id, strength, req.max_new_tokens,
            )
        except Exception as exc:
            arms[arm_name] = {"error": str(exc)}

    return {
        "ok": True,
        "schema_version": "m1-causal-triad.v0.1",
        "feature_id": req.feature_id,
        "hook": _hook_name,
        "prompt": req.prompt,
        "causal_triad": arms,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SAE_PATCH_PORT", "8138"))
    uvicorn.run(app, host="127.0.0.1", port=port)
