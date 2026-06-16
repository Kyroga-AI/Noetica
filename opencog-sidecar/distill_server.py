"""
HellGraph Distillation Server.

Implements the student-teacher knowledge distillation pipeline.
Uses tritfabric's KD loss (slate/distill/kd_loss.py) for whitebox→whitebox
distillation and behavioral cloning for blackbox→whitebox.

Policy: NEVER blackbox→blackbox (enforced at /distill/teacher registration).

Whitebox teacher path (teacher weights accessible locally):
  1. Load teacher via HuggingFace transformers
  2. Run batch inference → cache (prompt, teacher_logits) to JSONL
  3. Train student with KL-divergence KD loss + LoRA adapters

Blackbox teacher path (teacher is an API):
  1. Caller provides (prompt, teacher_response) pairs as JSONL
  2. Train student with next-token cross-entropy on teacher responses
     (sequence-level KD / behavioral cloning)

Endpoints:
  POST /distill/pairs      — submit training pairs (JSONL lines)
  POST /distill/train      — start a training run (async, returns job_id)
  GET  /distill/status     — poll job progress
  GET  /distill/export     — download current training pairs as JSONL
  GET  /distill/health     — availability + deps check

Configuration (env vars):
  DISTILL_PORT             — listen port            (default: 8139)
  DISTILL_OUTPUT_DIR       — training artifact dir  (default: ~/.noetica/distill)

Run:
  pip install -r requirements-gpu.txt
  uvicorn distill_server:app --host 127.0.0.1 --port 8139
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Dep checks ─────────────────────────────────────────────────────────────────

TORCH_AVAILABLE = False
HF_AVAILABLE = False
PEFT_AVAILABLE = False
_dep_errors: list[str] = []

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError as e:
    _dep_errors.append(f"torch: {e}")

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore
    HF_AVAILABLE = True
except ImportError as e:
    _dep_errors.append(f"transformers: {e}")

try:
    from peft import get_peft_model, LoraConfig, TaskType  # type: ignore
    PEFT_AVAILABLE = True
except ImportError as e:
    _dep_errors.append(f"peft: {e}")

# ── Config ────────────────────────────────────────────────────────────────────

_OUTPUT_DIR = Path(os.environ.get("DISTILL_OUTPUT_DIR", Path.home() / ".noetica" / "distill"))
_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_PAIRS_FILE = _OUTPUT_DIR / "training_pairs.jsonl"
_JOBS: dict[str, dict[str, Any]] = {}

app = FastAPI(title="HellGraph Distillation Server", version="0.1.0")

# ── Models ────────────────────────────────────────────────────────────────────

class TrainingPair(BaseModel):
    prompt: str
    chosen: str
    rejected: str | None = None
    teacher_model: str
    student_model: str
    teacher_logits: list[float] | None = None  # present for whitebox teacher

class PairsPayload(BaseModel):
    pairs: list[TrainingPair]

class TrainRequest(BaseModel):
    student_model_id: str
    teacher_type: str = "blackbox"  # "whitebox" or "blackbox"
    lora_r: int = 8
    lora_alpha: float = 16.0
    learning_rate: float = 2e-4
    max_steps: int = 100
    kd_alpha: float = 0.5
    kd_temperature: float = 4.0
    kd_topk: int | None = None
    kd_adaptive_T: bool = False

# ── Training pairs store ──────────────────────────────────────────────────────

def _load_pairs() -> list[dict[str, Any]]:
    if not _PAIRS_FILE.exists():
        return []
    rows = []
    for line in _PAIRS_FILE.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def _append_pairs(pairs: list[dict[str, Any]]) -> None:
    with _PAIRS_FILE.open("a", encoding="utf-8") as f:
        for pair in pairs:
            f.write(json.dumps(pair, sort_keys=True) + "\n")

# ── Distillation training loop ────────────────────────────────────────────────

def _run_training(job_id: str, req: TrainRequest) -> None:
    job = _JOBS[job_id]
    job["status"] = "running"
    job["started_at"] = time.time()

    if not (TORCH_AVAILABLE and HF_AVAILABLE and PEFT_AVAILABLE):
        job["status"] = "error"
        job["error"] = f"Missing deps: {', '.join(_dep_errors)}"
        return

    try:
        import torch as _torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        pairs = _load_pairs()
        if not pairs:
            job["status"] = "error"
            job["error"] = "No training pairs found — submit pairs first via POST /distill/pairs"
            return

        # Enforce whitebox-student requirement
        if req.teacher_type == "whitebox" and not HF_AVAILABLE:
            job["status"] = "error"
            job["error"] = "Whitebox distillation requires transformers package"
            return

        device = "cuda" if _torch.cuda.is_available() else "cpu"
        dtype  = _torch.bfloat16 if _torch.cuda.is_available() else _torch.float32

        job["log"] = [f"Loading student model: {req.student_model_id}"]
        tokenizer = AutoTokenizer.from_pretrained(req.student_model_id)
        tokenizer.pad_token = tokenizer.eos_token
        student = AutoModelForCausalLM.from_pretrained(req.student_model_id, torch_dtype=dtype).to(device)
        student.train()

        # Wrap with LoRA
        if PEFT_AVAILABLE:
            from peft import get_peft_model, LoraConfig, TaskType
            lora_cfg = LoraConfig(
                task_type=TaskType.CAUSAL_LM,
                r=req.lora_r,
                lora_alpha=req.lora_alpha,
                lora_dropout=0.05,
                bias="none",
            )
            student = get_peft_model(student, lora_cfg)
            student.print_trainable_parameters()
            job["log"].append(f"LoRA applied: r={req.lora_r}, alpha={req.lora_alpha}")

        optimizer = _torch.optim.AdamW(
            filter(lambda p: p.requires_grad, student.parameters()),
            lr=req.learning_rate,
        )

        # Select loss function based on teacher type
        if req.teacher_type == "whitebox":
            # KD loss from tritfabric (requires cached teacher logits)
            tritfabric_path = Path(__file__).parent.parent / "tritfabric" / "slate" / "distill"
            sys.path.insert(0, str(tritfabric_path))
            from kd_loss import kd_loss as _kd_loss  # type: ignore
        else:
            _kd_loss = None  # behavioral cloning path

        step = 0
        total = min(req.max_steps, len(pairs))
        job["total_steps"] = total

        for i, pair in enumerate(pairs[:total]):
            if job.get("cancelled"):
                job["status"] = "cancelled"
                return

            prompt_text = pair.get("prompt", "")
            chosen_text = pair.get("chosen", "")

            if req.teacher_type == "whitebox" and pair.get("teacher_logits") and _kd_loss:
                # Full KD: student vs cached teacher logits
                enc = tokenizer(prompt_text, return_tensors="pt", truncation=True, max_length=512).to(device)
                student_out = student(**enc)
                student_logits = student_out.logits[:, :-1, :]

                teacher_logits_t = _torch.tensor(
                    pair["teacher_logits"], dtype=_torch.float32, device=device
                ).unsqueeze(0).unsqueeze(0).expand_as(student_logits)

                labels = enc["input_ids"][:, 1:]
                loss = _kd_loss(
                    student_logits.reshape(-1, student_logits.shape[-1]),
                    teacher_logits_t.reshape(-1, teacher_logits_t.shape[-1]),
                    hard_labels=labels.reshape(-1),
                    alpha=req.kd_alpha,
                    T=req.kd_temperature,
                    topk=req.kd_topk,
                    adaptive_T=req.kd_adaptive_T,
                )
            else:
                # Behavioral cloning: next-token CE on teacher response
                full_text = prompt_text + "\n" + chosen_text
                enc = tokenizer(full_text, return_tensors="pt", truncation=True, max_length=512).to(device)
                labels = enc["input_ids"].clone()
                # Mask prompt tokens so we only supervise on the response
                prompt_len = len(tokenizer(prompt_text, return_tensors="pt")["input_ids"][0])
                labels[:, :prompt_len] = -100
                out = student(**enc, labels=labels)
                loss = out.loss

            optimizer.zero_grad()
            loss.backward()
            _torch.nn.utils.clip_grad_norm_(student.parameters(), 1.0)
            optimizer.step()

            step += 1
            job["step"] = step
            job["loss"] = float(loss.item())
            job["log"].append(f"step {step}/{total} loss={loss.item():.4f}")

        # Save LoRA adapter weights
        out_path = _OUTPUT_DIR / f"lora_{job_id}"
        out_path.mkdir(exist_ok=True)
        if PEFT_AVAILABLE:
            student.save_pretrained(str(out_path))
        tokenizer.save_pretrained(str(out_path))

        job["status"] = "done"
        job["adapter_path"] = str(out_path)
        job["finished_at"] = time.time()

    except Exception as exc:
        job["status"] = "error"
        job["error"] = f"{type(exc).__name__}: {exc}"

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/distill/health")
def health() -> dict[str, Any]:
    return {
        "available": TORCH_AVAILABLE and HF_AVAILABLE,
        "torch": TORCH_AVAILABLE,
        "transformers": HF_AVAILABLE,
        "peft": PEFT_AVAILABLE,
        "cuda": torch.cuda.is_available() if TORCH_AVAILABLE else False,
        "dep_errors": _dep_errors or None,
        "pairs_on_disk": len(_load_pairs()),
        "active_jobs": {jid: j["status"] for jid, j in _JOBS.items()},
    }


@app.post("/distill/pairs")
def submit_pairs(payload: PairsPayload) -> dict[str, Any]:
    """Accept labelled teacher/student comparison pairs for training."""
    rows = [p.model_dump() for p in payload.pairs]

    # Enforce: student must be whitebox (open-weight).
    # We can't verify this server-side, but we record the metadata and the
    # constraint is enforced in TuneSurface (student selector is whitebox-only).

    _append_pairs(rows)
    return {"ok": True, "added": len(rows), "total_on_disk": len(_load_pairs())}


@app.post("/distill/train")
def start_training(req: TrainRequest) -> dict[str, Any]:
    """Kick off a background training run. Returns a job_id for polling."""
    job_id = str(uuid.uuid4())[:8]
    _JOBS[job_id] = {
        "id": job_id,
        "status": "queued",
        "step": 0,
        "total_steps": 0,
        "loss": None,
        "error": None,
        "log": [],
        "adapter_path": None,
        "student_model_id": req.student_model_id,
        "teacher_type": req.teacher_type,
    }
    t = threading.Thread(target=_run_training, args=(job_id, req), daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id}


@app.get("/distill/status")
def training_status(job_id: str | None = None) -> dict[str, Any]:
    if job_id:
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        return job
    return {"jobs": list(_JOBS.values())}


@app.delete("/distill/job/{job_id}")
def cancel_job(job_id: str) -> dict[str, Any]:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    job["cancelled"] = True
    return {"ok": True, "job_id": job_id}


@app.get("/distill/export")
def export_pairs() -> dict[str, Any]:
    """Return all training pairs as a JSONL string."""
    pairs = _load_pairs()
    lines = "\n".join(json.dumps(p, sort_keys=True) for p in pairs)
    return {"jsonl": lines, "count": len(pairs)}


@app.delete("/distill/pairs")
def clear_pairs() -> dict[str, Any]:
    """Clear all training pairs from disk."""
    count = len(_load_pairs())
    _PAIRS_FILE.unlink(missing_ok=True)
    return {"ok": True, "cleared": count}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DISTILL_PORT", "8139"))
    uvicorn.run(app, host="127.0.0.1", port=port)
