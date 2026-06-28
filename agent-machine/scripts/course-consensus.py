#!/usr/bin/env python3
"""
course-consensus — recover formulas via CROSS-COURSE redundancy, and fix grow-canon's targeting. MIT teaches
F=ma across dozens of courses; each PDF mangles it differently. The key signal:

  REAL equation   → appears across MANY DISTINCT courses (high course-SPREAD)
  extraction noise→ recurs within ONE doc (high raw frequency, spread = 1)
  duplicate course→ same course NUMBER, different term/slug → redundant captures to cross-check

So course-spread (not raw frequency) surfaces the recoverable equations, and consensus across the duplicate/
sibling courses recovers the cleanest form. This is the recovery lever that needs no re-extraction.

Per domain: extract formula candidates WITH their course (slug) → group by normalized form → count distinct
courses + course-numbers → rank by spread → link to canon (matched = validate coverage; unmatched high-spread
= real equations to RECOVER/add). Also reports duplicate course offerings.

Run:  OCW_BRAIN=… python3 scripts/course-consensus.py [domain ...]   (MIN_SPREAD default 3)
"""
import os, sys, re, json, collections, importlib.util

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('cf', os.path.join(HERE, 'scripts', 'clean-formulas.py'))
cf = importlib.util.module_from_spec(spec); sys.argv = ['cf']; spec.loader.exec_module(cf)

BRAIN = os.environ.get('OCW_BRAIN', os.path.expanduser('~/Downloads/MIT OCW/_brain'))
MIN_SPREAD = int(os.environ.get('MIN_SPREAD', '3'))
MATERIAL = {'reference', 'lecture', 'solution', 'exam', 'assignment', 'recitation'}


def course_number(slug):
    """OCW slug → course number: '8-01-physics-i-fall-2003' → '8.01', '18-06sc-...' → '18.06'."""
    m = re.match(r'^([a-z]{0,4})?(\d+)[-.](\d+)([a-z]+)?', slug or '')
    if not m:
        return (slug or '?').split('-')[0]
    dept = m.group(1) or m.group(2)
    return f"{m.group(2)}.{m.group(3)}"


def normform(s):
    return re.sub(r'\s+', '', re.sub(r'[!⃗`*]', '', s.lower()))


def main():
    fields = sys.argv[1:] or [d for d in cf.canon if not d.startswith('_')]
    for field in fields:
        d = os.path.join(BRAIN, field)
        if not os.path.isdir(d):
            print(f"  {field}: no brain dir"); continue
        groups = collections.defaultdict(lambda: {'courses': set(), 'nums': set(), 'raws': collections.Counter()})
        course_slugs = collections.defaultdict(set)   # course-number → slugs (duplicate-offering detection)
        for fn in os.listdir(d):
            if not fn.endswith('.jsonl'):
                continue
            for ln in open(os.path.join(d, fn), errors='replace'):
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                if o.get('material') not in MATERIAL:
                    continue
                slug = o.get('slug') or o.get('source') or '?'
                cn = course_number(slug)
                course_slugs[cn].add(slug.rsplit('-', 1)[0] if '-' in slug else slug)
                for line in (o.get('text') or '').splitlines():
                    if cf.is_formula(line):
                        k = normform(line)
                        if 4 <= len(k) <= 120:
                            g = groups[k]; g['courses'].add(slug); g['nums'].add(cn); g['raws'][line.strip()] += 1
        # rank by COURSE-SPREAD (distinct course numbers) — the real-equation signal
        ranked = sorted(groups.values(), key=lambda g: (len(g['nums']), len(g['courses'])), reverse=True)
        eqs = cf.canon.get(field, [])
        dups = {cn: s for cn, s in course_slugs.items() if len(s) > 1}
        print(f"\n## {field} — {len(groups)} distinct formulas · {len(course_slugs)} courses · {len(dups)} duplicate-offering course #s")
        print(f"  {'spread':>6} {'courses':>7}  linked-canon            consensus form")
        shown = 0
        for g in ranked:
            if len(g['nums']) < MIN_SPREAD or shown >= 18:
                continue
            consensus = g['raws'].most_common(1)[0][0]              # cleanest/most-common raw across courses
            eq, score = cf.link(consensus, eqs)
            tag = f"✓ {eq['name']}" if eq else "— (RECOVER: high-spread, no canon match)"
            print(f"  {len(g['nums']):>6} {len(g['courses']):>7}  {tag:24} {consensus[:46]}")
            shown += 1
        if dups:
            ex = list(dups.items())[:3]
            print(f"  duplicate offerings (same course #, recover by cross-check): " +
                  ', '.join(f"{cn}×{len(s)}" for cn, s in ex))
    print(f"\n# course-SPREAD ≥ {MIN_SPREAD} = real equations (recover); spread=1 high-freq = doc artifacts (drop)")


if __name__ == '__main__':
    main()
