#!/usr/bin/env python3
"""snapshot-brain — lock down a versioned, content-hashed snapshot of the BRAIN (canon glossary/equations +
a reference to the stable OCW vector brain), so every learning update is measured against a frozen baseline.

  snapshot   python3 scripts/snapshot-brain.py --version v1 --note "frontier-remediation deltas live"
  baseline   python3 scripts/snapshot-brain.py --version v0 --from-git ff851de --note "pre-frontier baseline"
  attach     python3 scripts/snapshot-brain.py --attach v0 --run prodphyschem0629b --overall "baseline=61.1,opcompute=71.1,..."

Lock = content sha256 over the canon (sorted) + an immutable tarball in ~/.noetica/brain-snapshots/. The ledger
(~/.noetica/brain-versions.jsonl) + canon/VERSIONS.md track version -> canon hash -> board result over baseline."""
import argparse, hashlib, json, os, subprocess, tarfile, tempfile, datetime, glob
HERE = os.path.dirname(os.path.abspath(__file__)); CANON = os.path.join(HERE, '..', 'canon')
SNAPDIR = os.path.expanduser('~/.noetica/brain-snapshots'); LEDGER = os.path.expanduser('~/.noetica/brain-versions.jsonl')
OCW_BRAIN = 'gs://sourceos-artifacts-socioprophet/ocw-corpus/brain-complete.tar.gz'

def canon_files(d):
    return sorted(f for f in glob.glob(os.path.join(d,'**','*'), recursive=True) if os.path.isfile(f))

def canon_hash(d):
    h = hashlib.sha256()
    for f in canon_files(d):
        h.update(os.path.relpath(f,d).encode()); h.update(open(f,'rb').read())
    return h.hexdigest()

def canon_stats(d):
    terms=fr=0
    for f in glob.glob(os.path.join(d,'spec-*.json')):
        for t in json.load(open(f)).get('topics',[]):
            for g in t.get('glossary',[]):
                terms+=1; fr += (g.get('source')=='frontier-remediation')
    return terms, fr

def materialize(from_git):
    if not from_git: return CANON, None
    tmp = tempfile.mkdtemp(prefix='canon-'); rel='agent-machine/canon'
    files = subprocess.check_output(['git','-C',os.path.join(HERE,'..','..'),'ls-tree','-r','--name-only',from_git,rel]).decode().splitlines()
    for fp in files:
        out=os.path.join(tmp, os.path.relpath(fp, rel)); os.makedirs(os.path.dirname(out),exist_ok=True)
        open(out,'wb').write(subprocess.check_output(['git','-C',os.path.join(HERE,'..','..'),'show',f'{from_git}:{fp}']))
    return tmp, from_git

def load_ledger():
    return [json.loads(l) for l in open(LEDGER)] if os.path.exists(LEDGER) else []

def save_ledger(rows):
    open(LEDGER,'w').write('\n'.join(json.dumps(r) for r in rows)+'\n')
    # render VERSIONS.md
    lines=['# Brain Versions — locked canon snapshots + board results over baseline','',
           '| version | canon sha256 | glossary | frontier | git | board run | OVERALL by arm |','|---|---|---|---|---|---|---|']
    for r in rows:
        br=r.get('board') or {}; ov=' · '.join(f"{k} {v}" for k,v in br.get('overall',{}).items()) if br else '—'
        lines.append(f"| **{r['version']}** | `{r['canon_sha256'][:12]}` | {r['glossary_terms']} | {r['frontier_remediation']} | `{r.get('git_commit','-')[:8]}` | {br.get('run','—')} | {ov} |")
    lines += ['', '_Note:_ ' + (rows[-1].get('note','') if rows else ''), '', 'OCW vector brain (stable across versions): `'+OCW_BRAIN+'`']
    open(os.path.join(CANON,'VERSIONS.md'),'w').write('\n'.join(lines)+'\n')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--version'); ap.add_argument('--from-git'); ap.add_argument('--note',default='')
    ap.add_argument('--attach'); ap.add_argument('--run'); ap.add_argument('--overall')
    a=ap.parse_args(); os.makedirs(SNAPDIR,exist_ok=True); rows=load_ledger()
    if a.attach:
        for r in rows:
            if r['version']==a.attach:
                ov={kv.split('=')[0]:kv.split('=')[1] for kv in a.overall.split(',')} if a.overall else {}
                r['board']={'run':a.run,'overall':ov}; print(f"  attached board {a.run} to {a.attach}: {ov}")
        save_ledger(rows); return
    src, gitc = materialize(a.from_git)
    h=canon_hash(src); terms,fr=canon_stats(src)
    tar=os.path.join(SNAPDIR, f"canon-{a.version}-{h[:8]}.tar.gz")
    with tarfile.open(tar,'w:gz') as t: t.add(src, arcname='canon')
    parent = rows[-1]['version'] if rows else None
    rec={'version':a.version,'created_at':datetime.datetime.now().astimezone().isoformat(),'git_commit':gitc or subprocess.check_output(['git','-C',HERE,'rev-parse','HEAD']).decode().strip(),
         'canon_sha256':h,'glossary_terms':terms,'frontier_remediation':fr,'ocw_brain_ref':OCW_BRAIN,'snapshot':tar,'parent':parent,'note':a.note,'board':None}
    rows=[r for r in rows if r['version']!=a.version]+[rec]; save_ledger(rows)
    print(f"  LOCKED {a.version}: sha256={h[:12]} | {terms} terms ({fr} frontier) | {os.path.getsize(tar)//1024}KB tar | parent={parent}")

if __name__=='__main__': main()
