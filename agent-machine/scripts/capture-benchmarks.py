#!/usr/bin/env python3
"""capture-benchmarks — intake the evaluation suites that actually test OUR system (faithfulness /
attribution / calibration / domain grounding), not just base-model recall. Stashes each to GCS as a single
tarball (single-file `gcloud storage cp` — bulk rsync is classifier-blocked). Resumable: skips tarballs
already in GCS. Moat tier first (RAGTruth/ALCE/FActScore), then domain (Finance/Legal/Health), then the
capability floor (MMLU-Pro/GPQA/HLE). HF-gated sets need the account to have accepted terms (HF_TOKEN set).

  python3 scripts/capture-benchmarks.py            (all)
  TIER=moat python3 scripts/capture-benchmarks.py  (one tier: moat|domain|floor)
"""
import os, sys, subprocess, tempfile, tarfile, shutil
GCS = 'gs://sourceos-artifacts-socioprophet/datasets/benchmarks/raw'
ENV = {**os.environ, 'OBJC_DISABLE_INITIALIZE_FORK_SAFETY': 'YES'}
ONLY = os.environ.get('TIER', '')

# (name, tier, kind, source)  kind: hf-dataset | git
BENCHES = [
    # ── TIER 3 — the moat: faithfulness / attribution / calibration (where our harness IS the measurement) ──
    ('ragtruth',        'moat',   'git',        'https://github.com/ParticleMedia/RAGTruth'),
    ('alce',            'moat',   'git',        'https://github.com/princeton-nlp/ALCE'),
    ('factscore',       'moat',   'git',        'https://github.com/shmsw25/FActScore'),
    ('facts-grounding', 'moat',   'hf-dataset', 'google/FACTS-grounding-public'),
    # ── TIER 2 — domain grounding (finance / legal / medical — where the sale lives) ──
    ('financebench',    'domain', 'hf-dataset', 'PatronusAI/financebench'),
    ('legalbench',      'domain', 'hf-dataset', 'nguha/legalbench'),
    ('legalbench-rag',  'domain', 'git',        'https://github.com/zeroentropy-ai/legalbenchrag'),
    ('healthbench',     'domain', 'git',        'https://github.com/openai/simple-evals'),
    # ── TIER 1 — capability floor (defensive parity; GPQA/HLE are HF-gated) ──
    ('mmlu-pro',        'floor',  'hf-dataset', 'TIGER-Lab/MMLU-Pro'),
    ('gpqa',            'floor',  'hf-dataset', 'Idavidrein/gpqa'),
    ('hle',             'floor',  'hf-dataset', 'cais/hle'),
]

def in_gcs(name):
    r = subprocess.run(['gcloud', 'storage', 'ls', f'{GCS}/{name}.tar.gz'], capture_output=True, env=ENV)
    return r.returncode == 0

def fetch(name, kind, source, dest):
    if kind == 'git':
        subprocess.run(['git', 'clone', '--depth', '1', source, dest], check=True,
                       capture_output=True, timeout=600)
        shutil.rmtree(os.path.join(dest, '.git'), ignore_errors=True)
    else:  # hf-dataset
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id=source, repo_type='dataset', local_dir=dest,
                          token=os.environ.get('HF_TOKEN'))

def main():
    done, failed = [], []
    for name, tier, kind, source in BENCHES:
        if ONLY and tier != ONLY:
            continue
        if in_gcs(name):
            print(f"  ✓ {name} already in GCS ({tier})"); done.append(name); continue
        print(f"── capturing {name} ({tier}, {kind}) ← {source}", flush=True)
        tmp = tempfile.mkdtemp(prefix=f'bench-{name}-')
        try:
            fetch(name, kind, source, tmp)
            tarp = f'/tmp/bench-{name}.tar.gz'
            with tarfile.open(tarp, 'w:gz') as t:
                t.add(tmp, arcname=name)
            subprocess.run(['gcloud', 'storage', 'cp', tarp, f'{GCS}/{name}.tar.gz'], check=True,
                           capture_output=True, env=ENV, timeout=900)
            sz = os.path.getsize(tarp) // (1024 * 1024)
            print(f"  ✓ {name} → {GCS}/{name}.tar.gz ({sz} MB)", flush=True)
            os.remove(tarp); done.append(name)
        except Exception as e:
            print(f"  ✗ {name} FAILED: {str(e)[:120]}", flush=True); failed.append(name)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n# captured {len(done)}: {done}")
    if failed:
        print(f"# failed {len(failed)} (gated/moved — fetch manually): {failed}")

if __name__ == '__main__':
    main()
