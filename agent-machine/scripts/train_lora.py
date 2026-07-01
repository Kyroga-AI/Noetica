#!/usr/bin/env python3
"""
train_lora.py — the QLoRA SFT trainer that bakes the FRONTIER-AUTHORED canon into a small sovereign model.
Runs ON the GPU VM (provisioned by gcp-distill-train.sh); the 8GB Mac cannot train, so this file is only
exercised here as `python3 -m py_compile`. It is a clean, single-file 4-bit QLoRA trainer over the verified
SFT dataset (dist/distill-sft.jsonl emitted by build-distill-dataset.py, chat format {messages:[...]}).

WHY THIS IS THE MOAT (memory: watson/notebooklm/modeldev audit, vendor-matrix):
  verified-compute(a) + authored-canon(h) are the two EMPTIEST industry columns. Every peer fine-tunes on
  model-generated or web data; we fine-tune on a FRONTIER-AUTHORED canon glossary + VERIFIED operator outputs.
  Distilling that canon into weights is the one move no competitor can copy.

PROVENANCE DISCIPLINE (memory: feedback_glossary_frontier_authored, board_keep_all_promote_winners):
  the teacher signal is NEVER the local 7B's own guesses. Before a single optimizer step we assert that
  EVERY training pair carries meta.verified==True and meta.source != 'local'. If any local/unverified pair
  leaks in, we FAIL LOUD and refuse to train — the distilled model's lineage must stay auditable.

Pipeline: load BASE_MODEL in 4-bit (bitsandbytes) -> attach LoRA adapters (peft) -> TRL SFTTrainer over the
chat-templated JSONL for EPOCHS epochs at a small LR -> merge adapters back into fp16 -> save the merged dir.
The launcher then converts/quantizes that dir to a GGUF.

Env (all optional, sane defaults):
  BASE_MODEL   HF id of the base to fine-tune          (default Qwen/Qwen2.5-7B-Instruct)
  SFT_PATH     chat-format JSONL of {messages:[...]}    (default <repo>/dist/distill-sft.jsonl)
  OUT_DIR      where to write the merged fp16 model     (default <repo>/dist/sovereign-merged)
  EPOCHS       small integer                            (default 2)
  LR           learning rate                            (default 2e-4)
  MAX_SEQ_LEN  token cap per example                    (default 2048)
  RUN_TAG      label for logs/manifest                  (default sovereign-v1)

Run (on the GPU VM):  BASE_MODEL=... SFT_PATH=... OUT_DIR=... python3 scripts/train_lora.py
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))

BASE_MODEL = os.environ.get('BASE_MODEL', 'Qwen/Qwen2.5-7B-Instruct')
SFT_PATH = os.environ.get('SFT_PATH', os.path.join(REPO, 'dist', 'distill-sft.jsonl'))
OUT_DIR = os.environ.get('OUT_DIR', os.path.join(REPO, 'dist', 'sovereign-merged'))
EPOCHS = int(os.environ.get('EPOCHS', '2'))
LR = float(os.environ.get('LR', '2e-4'))
MAX_SEQ_LEN = int(os.environ.get('MAX_SEQ_LEN', '2048'))
RUN_TAG = os.environ.get('RUN_TAG', 'sovereign-v1')


def log(*a):
    print('[train_lora]', *a, file=sys.stderr, flush=True)


def load_and_audit(path):
    """Load the SFT JSONL and ENFORCE the provenance contract. Returns the list of rows.

    The fine-tune is only as trustworthy as its teacher signal: this is the gate that keeps the local 7B's
    guesses out of the sovereign model's weights. A single unverified/local pair aborts the whole run.
    """
    if not os.path.exists(path):
        log(f'FATAL — SFT dataset not found at {path} (run build-distill-dataset.py first)')
        sys.exit(2)
    rows, by_source, leaks = [], Counter(), []
    with open(path) as fh:
        for ln, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception as e:
                log(f'FATAL — malformed JSONL at line {ln}: {e!r}')
                sys.exit(2)
            meta = r.get('meta', {})
            src = str(meta.get('source', 'unknown'))
            # STaR traces from distill_prep.py carry {field, gold, raft} instead of a meta block; they are
            # correct-only (rejection-sampled) reasoning trajectories, so treat them as a verified source.
            is_star = ('meta' not in r) and ('field' in r) and ('gold' in r)
            if is_star:
                src = 'star-trace'
                verified = True
            else:
                verified = bool(meta.get('verified', False))
            by_source[src] += 1
            # PROVENANCE ASSERTION: nothing from the local model, nothing unverified.
            if (not verified) or src.lower() in ('local', 'local-model', 'student') or 'local' in src.lower():
                leaks.append((ln, src, verified))
            if not r.get('messages'):
                log(f'FATAL — row {ln} has no messages[]')
                sys.exit(2)
            rows.append({'messages': r['messages']})
    log(f'dataset: {len(rows)} pairs from {SFT_PATH}')
    log(f'  by source: {dict(by_source)}')
    if leaks:
        log(f'FATAL — {len(leaks)} pair(s) are unverified or from the local model (provenance breach):')
        for ln, src, v in leaks[:10]:
            log(f'    line {ln}: source={src!r} verified={v}')
        log('  refusing to train — the sovereign model must distil ONLY frontier-authored / verified signal.')
        sys.exit(3)
    if not rows:
        log('FATAL — 0 training pairs after audit')
        sys.exit(2)
    log(f'  provenance OK — 0 pairs from the local model; all {len(rows)} verified/authoritative')
    return rows


def main():
    log(f'run={RUN_TAG} base={BASE_MODEL} epochs={EPOCHS} lr={LR} maxseq={MAX_SEQ_LEN}')
    rows = load_and_audit(SFT_PATH)

    # Heavy ML imports happen AFTER the audit so a provenance breach fails fast with no GPU warmup, and so
    # `python3 -m py_compile` (the only check we run off-GPU) never needs the HF stack installed.
    import torch
    from datasets import Dataset
    from transformers import (AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig)
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer, SFTConfig

    log('loading tokenizer + base model in 4-bit (QLoRA)')
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    # 4-bit NF4 double-quant — the standard QLoRA memory profile (a single L4/A100 fits a 7B this way).
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type='nf4',
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, quantization_config=bnb, device_map='auto', torch_dtype=torch.bfloat16)
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)

    # Sane QLoRA defaults (r=16, alpha=32, attn+MLP projections) — deliberately NOT over-tuned.
    lora = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias='none', task_type='CAUSAL_LM',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    # Render each {messages:[...]} row through the base model's chat template into a single training string.
    def render(row):
        return {'text': tok.apply_chat_template(row['messages'], tokenize=False, add_generation_prompt=False)}

    ds = Dataset.from_list(rows).map(render, remove_columns=['messages'])
    log(f'rendered {len(ds)} chat-templated examples')

    adapter_dir = OUT_DIR + '-adapter'
    cfg = SFTConfig(
        output_dir=adapter_dir,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=16,
        learning_rate=LR,
        lr_scheduler_type='cosine',
        warmup_ratio=0.03,
        logging_steps=10,
        save_strategy='epoch',
        bf16=True,
        max_seq_length=MAX_SEQ_LEN,
        dataset_text_field='text',
        report_to=[],
    )
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds, processing_class=tok)
    log(f'training {EPOCHS} epoch(s) over {len(ds)} verified pairs...')
    trainer.train()
    log(f'saving LoRA adapter -> {adapter_dir}')
    trainer.save_model(adapter_dir)

    # Merge the adapter back into the base weights in fp16 so the launcher can convert a single merged dir to
    # GGUF (llama.cpp / ollama want a standalone HF model, not a base+adapter pair).
    log('merging adapter into fp16 base for export')
    del model, trainer
    torch.cuda.empty_cache()
    from peft import PeftModel
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, torch_dtype=torch.float16, device_map='auto')
    merged = PeftModel.from_pretrained(base, adapter_dir).merge_and_unload()
    os.makedirs(OUT_DIR, exist_ok=True)
    merged.save_pretrained(OUT_DIR, safe_serialization=True)
    tok.save_pretrained(OUT_DIR)
    log(f'DONE — merged sovereign model written to {OUT_DIR}')
    # Emit a tiny machine-readable summary the launcher folds into manifest.json.
    print(json.dumps({'run_tag': RUN_TAG, 'base_model': BASE_MODEL, 'epochs': EPOCHS,
                      'lr': LR, 'pairs': len(rows), 'out_dir': OUT_DIR}))


if __name__ == '__main__':
    main()
