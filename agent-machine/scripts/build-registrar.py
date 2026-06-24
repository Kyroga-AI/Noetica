#!/usr/bin/env python3
"""
build-registrar — the Alexandrian Academy's bursar/registrar backbone. Turns a pile of captured courses into a
WALKABLE DEGREE: Program → Requirement(units) → Subject → prereq → (our captured content). Backs INTO the
required courses from a degree program, tracks credit-hours (MIT units), and surfaces COVERAGE GAPS against
what we actually hold. Domain-agnostic — Physics (Course 8) today; Philosophy (Course 24), Sloan (15), any
department slot in identically.

Persona/method layer: each domain has a legendary teacher whose STYLE and METHOD the AI tutor embodies — and
the *method* generalizes (Socratic dialectic is a tutoring mode for any subject, not just philosophy).

Output: academy/registrar-<program>.json + a coverage report. Run:  python3 scripts/build-registrar.py
"""
import os, re, json, glob

HOME = os.path.expanduser('~')
BRAIN = os.environ.get('OCW_BRAIN', os.path.join(HOME, 'Downloads', 'MIT OCW', '_brain'))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACADEMY = os.path.join(HERE, 'academy'); os.makedirs(ACADEMY, exist_ok=True)

# ── what we hold: captured course-number families (e.g. 8-01sc → "8.01") ──────────────────────────────────
def captured_numbers():
    nums = set()
    for f in sorted(os.listdir(BRAIN)) if os.path.isdir(BRAIN) else []:
        d = os.path.join(BRAIN, f)
        if not os.path.isdir(d):
            continue
        for fn in glob.glob(os.path.join(d, '*.jsonl')):
            try:
                with open(fn, errors='replace') as fh:
                    for ln in fh:
                        m = re.match(r'^(\d+)-(\d+)', ln.split('"slug":"', 1)[-1][:20]) if '"slug"' in ln else None
                        if m:
                            nums.add(f"{m.group(1)}.{int(m.group(2)) if m.group(2).isdigit() else m.group(2)}")
            except Exception:
                pass
    return nums

# simpler + robust: collect distinct slugs, reduce to dept.number families
def captured_families():
    fam = set()
    for f in (os.listdir(BRAIN) if os.path.isdir(BRAIN) else []):
        d = os.path.join(BRAIN, f)
        if not os.path.isdir(d):
            continue
        for fn in glob.glob(os.path.join(d, '*.jsonl')):
            try:
                seen = set()
                with open(fn, errors='replace') as fh:
                    for ln in fh:
                        if '"slug"' not in ln:
                            continue
                        try:
                            slug = json.loads(ln).get('slug', '')   # brain jsonl uses ": " — must JSON-parse
                        except Exception:
                            continue
                        if slug in seen:
                            continue
                        seen.add(slug)
                        m = re.match(r'^(\d+)-(\d+)', slug)
                        if m:
                            fam.add(f"{m.group(1)}.{m.group(2)}")    # 8-01sc → 8.01 ; 18-044 → 18.044
            except Exception:
                pass
    return fam

# ── a degree program, model-authored from MIT's structure (validate vs the official catalogue) ────────────
PHYSICS_SB = {
    "program": "Physics SB (Course 8, Focus option)", "department": "8", "degree": "SB",
    "note": "model-authored from MIT's GIR + Course-8 structure; units in MIT credit-units (12u ≈ one subject). Validate vs catalog.",
    "requirements": [
        {"group": "General Institute Requirements — Science Core", "subjects": [
            {"n": "18.01", "title": "Calculus I", "u": 12}, {"n": "18.02", "title": "Calculus II", "u": 12},
            {"n": "8.01", "title": "Physics I: Classical Mechanics", "u": 12, "persona": "Walter Lewin"},
            {"n": "8.02", "title": "Physics II: Electricity & Magnetism", "u": 12, "persona": "Walter Lewin"},
            {"n": "5.111", "title": "Principles of Chemical Science", "u": 12},
            {"n": "7.012", "title": "Introductory Biology", "u": 12}]},
        {"group": "Departmental Core — Physics", "subjects": [
            {"n": "8.03", "title": "Physics III: Vibrations & Waves", "u": 12},
            {"n": "8.04", "title": "Quantum Physics I", "u": 12, "prereq": ["8.03", "18.03"]},
            {"n": "8.044", "title": "Statistical Physics I", "u": 12, "prereq": ["8.03"]},
            {"n": "8.05", "title": "Quantum Physics II", "u": 12, "prereq": ["8.04"]},
            {"n": "18.03", "title": "Differential Equations", "u": 12, "prereq": ["18.02"]},
            {"n": "8.13", "title": "Experimental Physics I (Junior Lab)", "u": 12, "prereq": ["8.04"]}]},
        {"group": "Focus Option — Advanced", "subjects": [
            {"n": "8.06", "title": "Quantum Physics III", "u": 12, "prereq": ["8.05"]},
            {"n": "8.07", "title": "Electromagnetism II", "u": 12, "prereq": ["8.03", "18.03"]},
            {"n": "8.044", "title": "(stat mech, see core)", "u": 0},
            {"n": "8.THU", "title": "Undergraduate Thesis", "u": 12}]},
    ],
}

# ── persona/method layer: the legend per domain + the teaching METHOD (which generalizes) ──────────────────
PERSONAS = {
    "physics": {"persona": "Walter Lewin", "method": "dramatic demonstration + visceral physical intuition", "anchor": "8.01/8.02 (captured)"},
    "mathematics": {"persona": "Gilbert Strang", "method": "geometric intuition over rote", "anchor": "18.06 (captured)"},
    "science_communication": {"persona": "Bill Nye", "method": "enthusiastic, accessible explanation"},
    "philosophy": {"persona": "Socrates", "method": "Socratic dialectic — questioning toward insight (a GENERAL tutoring mode, not just philosophy)", "anchor": "Course 24 — NOT YET captured"},
    "physics_intuition": {"persona": "Richard Feynman", "method": "first-principles, plain language"},
}


def main():
    have = captured_families()
    prog = PHYSICS_SB
    total_u = held_u = 0; n_req = n_have = 0; gaps = []
    for g in prog["requirements"]:
        for s in g["subjects"]:
            if s["u"] == 0:
                continue
            n_req += 1; total_u += s["u"]
            s["captured"] = s["n"] in have
            if s["captured"]:
                n_have += 1; held_u += s["u"]
            else:
                gaps.append(s["n"])
    prog["coverage"] = {"subjects_required": n_req, "subjects_captured": n_have,
                        "units_total": total_u, "units_held": held_u,
                        "pct_units_covered": round(100 * held_u / max(1, total_u)), "gaps": gaps}
    prog["personas"] = PERSONAS
    json.dump(prog, open(os.path.join(ACADEMY, "registrar-physics.json"), "w"), indent=1)

    print(f"# Alexandrian Academy — registrar backbone")
    print(f"## {prog['program']}  ({prog['degree']}, Dept {prog['department']})")
    for g in prog["requirements"]:
        print(f"\n  ▸ {g['group']}")
        for s in g["subjects"]:
            if s["u"] == 0:
                continue
            mark = "✓ have" if s.get("captured") else "· GAP "
            who = f"   ★ {s['persona']}" if s.get("persona") else ""
            pre = f"   prereq {s['prereq']}" if s.get("prereq") else ""
            print(f"      [{mark}] {s['n']:7} {s['title'][:42]:44} {s['u']:>2}u{who}{pre}")
    c = prog["coverage"]
    print(f"\n## COVERAGE: {c['subjects_captured']}/{c['subjects_required']} required subjects · "
          f"{c['units_held']}/{c['units_total']} units ({c['pct_units_covered']}%) · gaps: {', '.join(c['gaps']) or 'none'}")
    print("\n## PERSONA / METHOD layer (the AI teacher per domain):")
    for dom, p in PERSONAS.items():
        print(f"   {dom:22} → {p['persona']:16} — {p['method']}")
    print(f"\n# wrote academy/registrar-physics.json  ·  Course 24 (Philosophy / AI Socrates) = next capture target")


if __name__ == '__main__':
    main()
