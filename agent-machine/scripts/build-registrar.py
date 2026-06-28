#!/usr/bin/env python3
"""
build-registrar — the Alexandrian Academy's bursar/registrar backbone. Turns piles of captured courses into
WALKABLE DEGREES: Program → Requirement(units) → Subject → prereq → (our captured content). Backs INTO the
required courses from each degree program, tracks credit-hours (MIT units), and surfaces COVERAGE GAPS against
what we actually hold. Now spans the whole captured catalogue — Physics(8), EECS(6), Math(18), Biology(7),
Chemistry(5) — and is domain-agnostic (Philosophy Course 24 / Sloan 15 slot in identically).

Persona/method layer: each domain has a legendary teacher whose STYLE + METHOD the AI tutor embodies — and the
*method* generalizes (Socratic dialectic is a tutoring mode for any subject).

Output: academy/registrar-<dept>.json per degree + academy/catalogue.json (all degrees + coverage).
Run:  python3 scripts/build-registrar.py
"""
import os, re, json, glob

HOME = os.path.expanduser('~')
BRAIN = os.environ.get('OCW_BRAIN', os.path.join(HOME, 'Downloads', 'MIT OCW', '_brain'))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACADEMY = os.path.join(HERE, 'academy'); os.makedirs(ACADEMY, exist_ok=True)


def captured_families():
    fam = set()
    for f in (os.listdir(BRAIN) if os.path.isdir(BRAIN) else []):
        d = os.path.join(BRAIN, f)
        if not os.path.isdir(d):
            continue
        for fn in glob.glob(os.path.join(d, '*.jsonl')):
            try:
                with open(fn, errors='replace') as fh:
                    for ln in fh:
                        if '"slug"' not in ln:
                            continue
                        try:
                            slug = json.loads(ln).get('slug', '')   # brain jsonl uses ": " — must JSON-parse
                        except Exception:
                            continue
                        m = re.match(r'^(\d+)-(\d+)', slug)          # 8-01sc → 8.01 ; 18-044 → 18.044
                        if m:
                            fam.add(f"{m.group(1)}.{m.group(2)}")
            except Exception:
                pass
    return fam


# shared General Institute Requirements — Science Core (every MIT SB)
def gir():
    return {"group": "General Institute Requirements — Science Core", "subjects": [
        {"n": "18.01", "title": "Calculus I", "u": 12}, {"n": "18.02", "title": "Calculus II", "u": 12},
        {"n": "8.01", "title": "Physics I: Classical Mechanics", "u": 12, "persona": "Walter Lewin"},
        {"n": "8.02", "title": "Physics II: Electricity & Magnetism", "u": 12, "persona": "Walter Lewin"},
        {"n": "5.111", "title": "Principles of Chemical Science", "u": 12},
        {"n": "7.012", "title": "Introductory Biology", "u": 12}]}


# degree programs — model-authored from MIT's structure (validate vs the official catalogue). 12u ≈ one subject.
PROGRAMS = {
    "physics": {"program": "Physics SB (Course 8, Focus)", "department": "8", "degree": "SB", "domain": "physics",
                "requirements": [gir(), {"group": "Departmental Core — Physics", "subjects": [
                    {"n": "8.03", "title": "Physics III: Vibrations & Waves", "u": 12},
                    {"n": "8.04", "title": "Quantum Physics I", "u": 12, "prereq": ["8.03", "18.03"]},
                    {"n": "8.044", "title": "Statistical Physics I", "u": 12},
                    {"n": "8.05", "title": "Quantum Physics II", "u": 12, "prereq": ["8.04"]},
                    {"n": "18.03", "title": "Differential Equations", "u": 12, "prereq": ["18.02"]},
                    {"n": "8.06", "title": "Quantum Physics III", "u": 12, "prereq": ["8.05"]},
                    {"n": "8.07", "title": "Electromagnetism II", "u": 12}, {"n": "8.13", "title": "Junior Lab", "u": 12}]}]},
    "eecs": {"program": "Computer Science SB (Course 6-3)", "department": "6", "degree": "SB", "domain": "eecs",
             "requirements": [gir(), {"group": "Departmental Core — CS", "subjects": [
                 {"n": "6.006", "title": "Introduction to Algorithms", "u": 12, "prereq": ["6.042"]},
                 {"n": "6.042", "title": "Mathematics for Computer Science", "u": 12},
                 {"n": "6.004", "title": "Computation Structures", "u": 12},
                 {"n": "6.034", "title": "Artificial Intelligence", "u": 12},
                 {"n": "6.046", "title": "Design & Analysis of Algorithms", "u": 12, "prereq": ["6.006"]},
                 {"n": "6.036", "title": "Introduction to Machine Learning", "u": 12},
                 {"n": "18.06", "title": "Linear Algebra", "u": 12, "persona": "Gilbert Strang"}]}]},
    "mathematics": {"program": "Mathematics SB (Course 18)", "department": "18", "degree": "SB", "domain": "mathematics",
                    "requirements": [gir(), {"group": "Departmental Core — Math", "subjects": [
                        {"n": "18.03", "title": "Differential Equations", "u": 12, "prereq": ["18.02"]},
                        {"n": "18.06", "title": "Linear Algebra", "u": 12, "persona": "Gilbert Strang"},
                        {"n": "18.100", "title": "Real Analysis", "u": 12},
                        {"n": "18.701", "title": "Algebra I", "u": 12}, {"n": "18.702", "title": "Algebra II", "u": 12, "prereq": ["18.701"]},
                        {"n": "18.901", "title": "Introduction to Topology", "u": 12}]}]},
    "biology": {"program": "Biology SB (Course 7)", "department": "7", "degree": "SB", "domain": "biology",
                "requirements": [gir(), {"group": "Departmental Core — Biology", "subjects": [
                    {"n": "7.03", "title": "Genetics", "u": 12, "prereq": ["7.012"]},
                    {"n": "7.05", "title": "General Biochemistry", "u": 12},
                    {"n": "7.06", "title": "Cell Biology", "u": 12, "prereq": ["7.03"]},
                    {"n": "5.12", "title": "Organic Chemistry I", "u": 12}, {"n": "7.02", "title": "Experimental Biology Lab", "u": 12}]}]},
    "chemistry": {"program": "Chemistry SB (Course 5)", "department": "5", "degree": "SB", "domain": "chemistry",
                  "requirements": [gir(), {"group": "Departmental Core — Chemistry", "subjects": [
                      {"n": "5.12", "title": "Organic Chemistry I", "u": 12}, {"n": "5.13", "title": "Organic Chemistry II", "u": 12, "prereq": ["5.12"]},
                      {"n": "5.60", "title": "Thermodynamics & Kinetics", "u": 12}, {"n": "5.61", "title": "Physical Chemistry", "u": 12},
                      {"n": "5.07", "title": "Biological Chemistry", "u": 12}, {"n": "18.03", "title": "Differential Equations", "u": 12}]}]},
    # ── graduate / doctoral programs (research degrees: grad core + general exam + thesis) ──────────────────
    "physics_phd": {"program": "Physics PhD (Course 8)", "department": "8", "degree": "PhD", "domain": "physics",
                    "requirements": [{"group": "Graduate Core — Physics", "subjects": [
                        {"n": "8.321", "title": "Quantum Theory I", "u": 12},
                        {"n": "8.322", "title": "Quantum Theory II", "u": 12, "prereq": ["8.321"]},
                        {"n": "8.333", "title": "Statistical Mechanics I", "u": 12},
                        {"n": "8.334", "title": "Statistical Mechanics II", "u": 12, "prereq": ["8.333"]},
                        {"n": "8.311", "title": "Electromagnetism (graduate)", "u": 12},
                        {"n": "8.323", "title": "Relativistic Quantum Field Theory I", "u": 12, "prereq": ["8.322"]},
                        {"n": "8.THG", "title": "Doctoral Thesis", "u": 36}]}]},
    "mathematics_phd": {"program": "Mathematics PhD (Course 18)", "department": "18", "degree": "PhD", "domain": "mathematics",
                        "requirements": [{"group": "Graduate Core — Math", "subjects": [
                            {"n": "18.705", "title": "Commutative Algebra", "u": 12},
                            {"n": "18.745", "title": "Lie Groups and Lie Algebras", "u": 12},
                            {"n": "18.155", "title": "Differential Analysis I", "u": 12},
                            {"n": "18.905", "title": "Algebraic Topology I", "u": 12},
                            {"n": "18.906", "title": "Algebraic Topology II", "u": 12, "prereq": ["18.905"]},
                            {"n": "18.THG", "title": "Doctoral Thesis", "u": 36}]}]},
    "eecs_grad": {"program": "EECS SM/PhD (Course 6)", "department": "6", "degree": "PhD", "domain": "eecs",
                  "requirements": [{"group": "Graduate Core — EECS", "subjects": [
                      {"n": "6.840", "title": "Theory of Computation", "u": 12},
                      {"n": "6.046", "title": "Design & Analysis of Algorithms", "u": 12},
                      {"n": "6.867", "title": "Machine Learning (graduate)", "u": 12},
                      {"n": "6.824", "title": "Distributed Systems", "u": 12},
                      {"n": "6.THG", "title": "Doctoral Thesis", "u": 36}]}]},
}

PERSONAS = {
    "physics": {"persona": "Walter Lewin", "method": "dramatic demonstration + visceral physical intuition", "anchor": "8.01/8.02 (captured)"},
    "mathematics": {"persona": "Gilbert Strang", "method": "geometric intuition over rote", "anchor": "18.06 (captured)"},
    "eecs": {"persona": "Patrick Winston", "method": "AI taught as story + first principles", "anchor": "6.034 (captured)"},
    "science_communication": {"persona": "Bill Nye", "method": "enthusiastic, accessible explanation"},
    "literature": {"persona": "Mark Twain", "method": "wit, vernacular, narrative"},
    "civics": {"persona": "Thomas Jefferson", "method": "first-principles republican reasoning"},
    "philosophy": {"persona": "Socrates", "method": "Socratic dialectic — questioning toward insight (a GENERAL tutoring mode, not just philosophy)", "anchor": "Course 24 — NOT YET captured"},
}


def evaluate(prog, have):
    total_u = held_u = n_req = n_have = 0; gaps = []
    for g in prog["requirements"]:
        for s in g["subjects"]:
            n_req += 1; total_u += s["u"]
            s["captured"] = s["n"] in have
            if s["captured"]:
                n_have += 1; held_u += s["u"]
            else:
                gaps.append(s["n"])
    prog["coverage"] = {"subjects_required": n_req, "subjects_captured": n_have, "units_total": total_u,
                        "units_held": held_u, "pct": round(100 * held_u / max(1, total_u)), "gaps": gaps}
    return prog


def main():
    have = captured_families()
    catalogue = {"personas": PERSONAS, "degrees": []}
    print("# Alexandrian Academy — registrar backbone (walkable MIT degrees)\n")
    for key, prog in PROGRAMS.items():
        evaluate(prog, have)
        prog["persona"] = PERSONAS.get(prog["domain"], {}).get("persona")
        json.dump(prog, open(os.path.join(ACADEMY, f"registrar-{key}.json"), "w"), indent=1)
        c = prog["coverage"]
        catalogue["degrees"].append({"program": prog["program"], "department": prog["department"],
                                     "persona": prog["persona"], **c})
        bar = "█" * (c["pct"] // 10) + "·" * (10 - c["pct"] // 10)
        print(f"  {prog['program']:34} {bar} {c['pct']:>3}%  ({c['subjects_captured']}/{c['subjects_required']} subj, "
              f"{c['units_held']}/{c['units_total']}u)  ★ {prog['persona']}")
        if c["gaps"]:
            print(f"      gaps: {', '.join(c['gaps'])}")
    json.dump(catalogue, open(os.path.join(ACADEMY, "catalogue.json"), "w"), indent=1)
    avg = round(sum(d["pct"] for d in catalogue["degrees"]) / max(1, len(catalogue["degrees"])))
    print(f"\n## {len(catalogue['degrees'])} walkable degrees · mean coverage {avg}% · → academy/catalogue.json")
    print("## persona/method roster (the AI teacher per domain):")
    for dom, p in PERSONAS.items():
        print(f"   {dom:22} → {p['persona']:18} — {p['method']}")
    print("\n# Course 24 (Philosophy / AI Socrates), Twain (literature), Jefferson (civics) = next captures")


if __name__ == '__main__':
    main()
