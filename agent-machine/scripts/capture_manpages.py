#!/usr/bin/env python3
"""
capture_manpages — capture the OPERATIONAL knowledge tier from the system's man pages.

Renders every installed man page, cleans the roff overstrike formatting, tags each by
subject (tool) · man section · academic domain · knowledge type, chunks it, and writes the
operational corpus (JSONL) — ready to embed into the atomspace `scope:"ops"` tier. See
docs/architecture/operational-knowledge-tier.md.

Run:  python3 scripts/capture_manpages.py
"""
import os, glob, gzip, re, subprocess, json, shutil
from collections import Counter

OUT = os.path.expanduser('~/.noetica/ops-corpus')
os.makedirs(OUT, exist_ok=True)
MAN_DIRS = [f'/usr/share/man/man{s}' for s in (1, 2, 3, 5, 7, 8)]
SECTION_TYPE = {'1': 'command', '2': 'syscall', '3': 'library', '5': 'config', '7': 'concept', '8': 'admin'}
# man section → knowledge type (commands/admin are how-to = Procedural; the rest are reference)
SECTION_KTYPE = {'1': 'Procedural', '8': 'Procedural', '2': 'BasicFacts', '3': 'BasicFacts', '5': 'Definition', '7': 'Definition'}
# keyword in tool name → academic domain (the bridge to golden + ontogenesis)
DOMAIN_RULES = [
    (r'ssl|tls|crypt|gpg|cert|sign|hash|rsa|aes|sha', 'cryptography'),
    (r'ssh|tcp|udp|ip|curl|wget|netcat|^nc$|ping|dns|dig|host|http|socket|route|ftp|smtp|telnet', 'networking'),
    (r'gcloud|kubectl|kube|docker|helm|terraform|aws|cloud|podman|nomad', 'distributed_systems'),
    (r'psql|postgres|mysql|sqlite|redis|mongo|^db', 'databases'),
    (r'git|svn|^hg$|cvs|diff|patch|make|cmake|ninja|gradle', 'software_engineering'),
    (r'python|node|npm|gcc|clang|rust|cargo|^go$|java|perl|ruby|tsc|llvm|^cc$|^ld$', 'languages_compilers'),
    (r'jq|^yq$|xml|json|sed|awk|grep|cut|sort|tr|regex', 'text_data_processing'),
    (r'bash|zsh|^sh$|ls|^cd$|find|tar|gzip|chmod|chown|^ps$|kill|cron|systemctl|launchctl|mount|^dd$', 'operating_systems'),
]


def domain_of(name):
    for pat, dom in DOMAIN_RULES:
        if re.search(pat, name, re.I):
            return dom
    return 'systems_general'


def render(path):
    try:
        raw = gzip.open(path, 'rb').read() if path.endswith('.gz') else open(path, 'rb').read()
        p = subprocess.run(['mandoc', '-T', 'utf8', '-O', 'width=100'], input=raw,
                           capture_output=True, timeout=20)
        txt = p.stdout.decode('utf-8', 'ignore')
    except Exception:
        return ''
    txt = re.sub(r'.\x08', '', txt)                      # strip overstrike (bold/underline)
    txt = re.sub(r'\x1b\[[0-9;]*m', '', txt)             # strip ANSI
    txt = re.sub(r'[ \t]+\n', '\n', txt)
    return re.sub(r'\n{3,}', '\n\n', txt).strip()


def chunks(t, size=1200):
    return [t[i:i + size] for i in range(0, len(t), size)] or []


def main():
    have_mandoc = shutil.which('mandoc')
    if not have_mandoc:
        print("  mandoc not found — install with: brew install mandoc"); return
    out = open(os.path.join(OUT, 'manpages.jsonl'), 'w', encoding='utf-8')
    dom_c, sec_c, npages, nchunks = Counter(), Counter(), 0, 0
    seen = set()
    for d in MAN_DIRS:
        section = d[-1]
        for f in sorted(glob.glob(d + '/*')):
            name = re.sub(r'\.\d.*$', '', os.path.basename(f))
            key = (name, section)
            if key in seen:
                continue
            seen.add(key)
            text = render(f)
            if len(text) < 120:
                continue
            dom = domain_of(name)
            npages += 1; dom_c[dom] += 1; sec_c[section] += 1
            for ci, ch in enumerate(chunks(text)):
                if len(ch.strip()) < 80:
                    continue
                out.write(json.dumps({
                    'tier': 'operational', 'subject': name, 'man_section': section,
                    'type': SECTION_TYPE.get(section, 'reference'),
                    'domain': dom, 'knowledge_type': SECTION_KTYPE.get(section, 'Definition'),
                    'chunk_index': ci, 'text': ch,
                }) + '\n')
                nchunks += 1
    out.close()
    print(f"# capture_manpages — {npages} man pages → {nchunks} chunks → {OUT}/manpages.jsonl\n")
    print("  by academic domain:")
    for dom, c in dom_c.most_common():
        print(f"    {dom:22} {c:>4} pages")
    print("\n  by man section (knowledge type):")
    for s, c in sorted(sec_c.items()):
        print(f"    man{s} ({SECTION_TYPE.get(s,'?'):8} → {SECTION_KTYPE.get(s,'?'):10}) {c:>4}")


if __name__ == '__main__':
    main()
