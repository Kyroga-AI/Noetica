#!/usr/bin/env python3
"""canon-to-ontogenesis.py

Publish the Noetica "canon" (agent-machine/canon/spec-*.json + keyvec-alignment.json)
as a governed Knowledge-Context Domain module inside the SocioProphet *ontogenesis*
ontology framework.

This is an ADDITIVE, spec-first bridge. It reads the canon and EMITS a SHACL-conformant
instance graph (ABox) typed against ontogenesis's existing Domain TBoxes (Upper core +
Domains/math.ttl + Platform/knowledge-context.ttl), together with:

  - Domains/knowledge-commons-canon.ttl   (module TBox + ABox instance graph)
  - contexts/knowledge-commons-canon.context.jsonld  (JSON-LD surface)
  - shapes/knowledge-commons-canon.shacl.ttl         (module-local promotion gates)
  - catalog registry entries (registry.ttl + registry.jsonld supplements)

Mapping (conforms to what the ontogenesis SHACL gates require):
  glossary term  -> skos:Concept (skos:prefLabel + skos:definition), typed to a domain
                    KnowledgeConcept class, skos:broader its topic concept.
  canon equation -> instance of math:Equation (math domain) or kcc:Formula
                    (subClassOf math:Equation) for the other domains, with
                    math:hasStatement = form and dct:subject = topic concept.
  topic          -> skos:Concept taxonomy (skos:broader to the domain concept,
                    skos:narrower to its glossary/canon children) carrying kcc:level.
  MMLU / MMLU-Pro alignment (keyvec-alignment.json) -> a kcc:TestSubject concept per
                    test subject, linked from each topic concept by skos:closeMatch
                    (cos >= 0.45) or skos:relatedMatch (cos < 0.45), with the cosine
                    preserved on a reified kcc:AlignmentEdge carrying kcc:cosine.

The whole module is anchored by one kc:KnowledgeContext instance (carrying the
required kc:schemaLabel + kc:contextLabel) so the canon participates in the
Knowledge-Context governance idiom.

Run:
  python3 canon-to-ontogenesis.py --ontogenesis ~/dev/ontogenesis
Then validate inside ontogenesis:
  python scripts/validate_rdf.py && python scripts/shacl_gate.py
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Namespaces (must match docs/specs/namespaces.md + existing TBoxes)
# ---------------------------------------------------------------------------
BASE = "https://socioprophet.github.io/ontogenesis/"
KCC = "https://socioprophet.github.io/ontogenesis/domains/knowledge-commons-canon#"
MATH = "https://socioprophet.github.io/ontogenesis/domains/math#"
KC = "https://socioprophet.github.io/ontogenesis/platform/knowledge-context#"
UPPER = "https://socioprophet.github.io/ontogenesis/upper#"
OG = "https://socioprophet.github.io/ontogenesis/og#"
SKOS = "http://www.w3.org/2004/02/skos/core#"
DCT = "http://purl.org/dc/terms/"
XSD = "http://www.w3.org/2001/XMLSchema#"

DOMAINS = ["physics", "chemistry", "mathematics", "biology",
           "computer_science", "economics"]

# canon item types that should be modeled as a Formula/Equation artifact
FORMULA_TYPES = {"equation", "law", "theorem", "principle", "algorithm"}

GAP_THRESHOLD = 0.45  # cos >= -> closeMatch ; below -> relatedMatch


# ---------------------------------------------------------------------------
# IRI helpers
# ---------------------------------------------------------------------------
def slug(*parts: str) -> str:
    raw = "-".join(p for p in parts if p)
    raw = raw.lower()
    raw = raw.replace("&", " and ")
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or "x"


def esc(s: str) -> str:
    """Escape a Python string for a Turtle long-string ('''...''')."""
    if s is None:
        s = ""
    s = s.replace("\\", "\\\\")
    s = s.replace("'''", "\\'\\'\\'")
    # keep newlines literal inside a triple-quoted turtle literal, but normalize
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    return s


def lit(s: str) -> str:
    return "'''" + esc(s) + "'''"


def topic_iri(domain: str, topic: str) -> str:
    return f"<{KCC}topic-{slug(domain, topic)}>"


def domain_iri(domain: str) -> str:
    return f"<{KCC}domain-{slug(domain)}>"


def term_iri(domain: str, topic: str, term: str) -> str:
    return f"<{KCC}term-{slug(domain, topic, term)}>"


def formula_iri(domain: str, topic: str, name: str) -> str:
    return f"<{KCC}formula-{slug(domain, topic, name)}>"


def subject_iri(subject: str) -> str:
    # subject like "mmlu:college_biology" or "pro:math"
    return f"<{KCC}test-{slug(subject)}>"


def align_iri(domain: str, topic: str, subject: str) -> str:
    return f"<{KCC}align-{slug(domain, topic)}--{slug(subject)}>"


# ---------------------------------------------------------------------------
# Load canon
# ---------------------------------------------------------------------------
def load_canon(canon_dir: Path):
    specs = {}
    for dom in DOMAINS:
        p = canon_dir / f"spec-{dom}.json"
        if p.exists():
            specs[dom] = json.loads(p.read_text())
    align_path = canon_dir / "keyvec-alignment.json"
    align = json.loads(align_path.read_text()) if align_path.exists() else {}
    # the INDUCED knowledge to type: seq2seq cards (mined equations) + the frontier KGI triples
    cards = []
    cpath = canon_dir / "cards.jsonl"
    if cpath.exists():
        cards = [json.loads(l) for l in cpath.read_text().splitlines() if l.strip()]
    induced = []
    ipath = canon_dir / "induced-kg.jsonl"
    if ipath.exists():
        induced = [json.loads(l) for l in ipath.read_text().splitlines() if l.strip()]
    # the rest of the DERIVED knowledge, each with its true epistemic mode:
    #   lexical IS-A → DEDUCED (rule) · prereq → ABDUCED (hypothesis) · analogy → ABDUCED · KGI → INDUCED
    lexical = json.loads((canon_dir / "lexical-hierarchy.json").read_text()).get("edges", []) \
        if (canon_dir / "lexical-hierarchy.json").exists() else []
    prereq = json.loads((canon_dir / "prereq-dag.json").read_text()) \
        if (canon_dir / "prereq-dag.json").exists() else {}
    analogies = json.loads((canon_dir / "analogies.json").read_text()).get("analogies", []) \
        if (canon_dir / "analogies.json").exists() else []
    return specs, align, cards, induced, lexical, prereq, analogies


# ---------------------------------------------------------------------------
# Emit module TTL (TBox + ABox)
# ---------------------------------------------------------------------------
def emit_module(specs, align, cards, induced, lexical, prereq, analogies) -> tuple[str, dict]:
    out: list[str] = []
    counts = dict(domains=0, topics=0, concepts=0, formulas=0,
                  test_subjects=0, alignment_edges=0, cards=0,
                  induced=0, deduced=0, abduced=0)

    A = out.append
    A("@base <%s> ." % BASE)
    A("@prefix kcc:   <%s> ." % KCC)
    A("@prefix math:  <%s> ." % MATH)
    A("@prefix kc:    <%s> ." % KC)
    A("@prefix upper: <%s> ." % UPPER)
    A("@prefix skos:  <%s> ." % SKOS)
    A("@prefix owl:   <http://www.w3.org/2002/07/owl#> .")
    A("@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .")
    A("@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .")
    A("@prefix xsd:   <%s> ." % XSD)
    A("@prefix dct:   <%s> ." % DCT)
    A("@prefix kko:   <http://kbpedia.org/ontologies/kko#> .")   # KBpedia/KKO — the STANDARD Peircean upper ontology
    A("")
    A("##############################################################################")
    A("# Domain — Knowledge Commons Canon (Noetica canon bridge)")
    A("#")
    A("# GENERATED by Noetica/agent-machine/scripts/canon-to-ontogenesis.py")
    A("# from agent-machine/canon/spec-*.json + keyvec-alignment.json.")
    A("# Additive, spec-first. Edit the generator, not this file.")
    A("##############################################################################")
    A("")
    A("<Domains/knowledge-commons-canon.ttl> a owl:Ontology ;")
    A('  dct:title "Domain — Knowledge Commons Canon" ;')
    A('  dct:description "Governed Knowledge-Context module publishing the Noetica '
      'open-courseware canon (glossary, canonical equations/laws/theorems, topic '
      'taxonomy, and MMLU/MMLU-Pro eval-anchoring) into the Ontogenesis framework." ;')
    A('  dct:source "Noetica/agent-machine/canon" ;')
    A('  owl:versionInfo "0.1.0" ;')
    A("  owl:imports <Upper/upper-core.ttl>, <Domains/math.ttl>, "
      "<Platform/knowledge-context.ttl>, <http://kbpedia.org/ontologies/kko> .")
    A("")
    A("### KBpedia/KKO grounding — the STANDARD Peircean upper ontology (CC-BY-4.0). Noetica's hand-rolled")
    A("### structures are aligned to KKO so the epistemic typing, the matter/form core, and the discovery")
    A("### loop are standards-backed, not ad-hoc. See canon/kko-alignment.json.")
    A("kcc:CanonKnowledgeContext skos:closeMatch kko:Methodeutic .   # the canon's discovery process = Peirce's methodeutic")
    A("kcc:Matter   rdfs:subClassOf kko:Matter .                     # chomer (matter) → KKO")
    A("kcc:Form     rdfs:subClassOf kko:Forms .                      # tzurah (form)  → KKO")
    A("kcc:Firstness  owl:equivalentClass kko:Possibilities .        # universal categories")
    A("kcc:Secondness owl:equivalentClass kko:Particulars .")
    A("kcc:Thirdness  owl:equivalentClass kko:Generals .")
    A("")
    A("### TBox — module classes & properties")
    A("kcc:KnowledgeConcept a owl:Class ; rdfs:subClassOf upper:Entity, skos:Concept ; "
      'rdfs:label "Knowledge concept" ; rdfs:comment "A canon glossary term or topic, '
      'modeled as a SKOS concept inside a governed domain." .')
    A("kcc:Topic a owl:Class ; rdfs:subClassOf kcc:KnowledgeConcept ; "
      'rdfs:label "Canon topic" .')
    A("kcc:GlossaryTerm a owl:Class ; rdfs:subClassOf kcc:KnowledgeConcept ; "
      'rdfs:label "Glossary term" .')
    A("kcc:TestSubject a owl:Class ; rdfs:subClassOf kcc:KnowledgeConcept ; "
      'rdfs:label "Evaluation test subject" ; rdfs:comment "An MMLU or MMLU-Pro '
      'subject used as an eval anchor for canon coverage." .')
    A("kcc:Formula a owl:Class ; rdfs:subClassOf math:Equation ; "
      'rdfs:label "Canon formula" ; rdfs:comment "A canonical equation, law, '
      'theorem, principle, or algorithm statement from the canon. Subclass of '
      'math:Equation so the math TBox carries it for non-math domains too." .')
    A("kcc:AlignmentEdge a owl:Class ; rdfs:subClassOf upper:Evidence ; "
      'rdfs:label "Eval alignment edge" ; rdfs:comment "Reified topic<->test-subject '
      'alignment carrying the keyed-vector cosine, preserving eval-anchoring." .')
    A("")
    A("kcc:level a owl:DatatypeProperty ; rdfs:domain kcc:Topic ; rdfs:range xsd:string ; "
      'rdfs:label "topic level" .')
    A("kcc:mmluProCategory a owl:DatatypeProperty ; rdfs:domain kcc:KnowledgeConcept ; "
      'rdfs:range xsd:string ; rdfs:label "MMLU-Pro category" .')
    # NB: intentionally NO rdfs:domain on canonType. It is carried by both Formula
    # nodes and definition-style GlossaryTerm nodes; declaring a domain would make
    # rdfs:domain inference retype one family as the other and trip the SHACL gates.
    A("kcc:canonType a owl:DatatypeProperty ; "
      'rdfs:range xsd:string ; rdfs:label "canon item type" .')
    A("kcc:cosine a owl:DatatypeProperty ; rdfs:domain kcc:AlignmentEdge ; "
      'rdfs:range xsd:decimal ; rdfs:label "alignment cosine" .')
    A("kcc:alignsTopic a owl:ObjectProperty ; rdfs:domain kcc:AlignmentEdge ; "
      'rdfs:range kcc:Topic ; rdfs:label "aligns topic" .')
    A("kcc:alignsSubject a owl:ObjectProperty ; rdfs:domain kcc:AlignmentEdge ; "
      'rdfs:range kcc:TestSubject ; rdfs:label "aligns subject" .')
    A("kcc:inKnowledgeContext a owl:ObjectProperty ; rdfs:domain upper:Entity ; "
      'rdfs:range kc:KnowledgeContext ; rdfs:label "in knowledge context" .')
    A("kcc:DerivedAssertion a owl:Class ; rdfs:subClassOf upper:Evidence, kko:Methodeutic ; "
      'rdfs:label "Derived assertion" ; rdfs:comment "A reified (subject, relation, object) triple over canon '
      'concepts that was DERIVED, not authored — carrying its relation, provenance, and EPISTEMIC MODE so '
      'routing/QA can trust it appropriately: deduced (rule, certain) > induced (generalized from data) > '
      'abduced (best-explanation hypothesis). Grounded in kko:Methodeutic (Peirce\'s knowledge-emergence process)." .')
    A("kcc:epistemicMode a owl:DatatypeProperty ; rdfs:domain kcc:DerivedAssertion ; "
      'rdfs:range xsd:string ; rdfs:label "epistemic mode" ; rdfs:comment "induced | deduced | abduced — '
      'Peirce\'s inference trichotomy (KKO/methodeutic). deduced=necessary, induced=generalization, abduced=hypothesis." .')
    A("### the three epistemic modes ARE Peirce's inference trichotomy (the basis of KKO)")
    A('kcc:deduced a kcc:EpistemicMode ; skos:closeMatch kko:Methodeutic ; rdfs:label "deduced (Peircean deduction)" .')
    A('kcc:induced a kcc:EpistemicMode ; skos:closeMatch kko:Methodeutic ; rdfs:label "induced (Peircean induction)" .')
    A('kcc:abduced a kcc:EpistemicMode ; skos:closeMatch kko:Methodeutic ; rdfs:label "abduced (Peircean abduction)" .')
    A("kcc:inducedRelation a owl:DatatypeProperty ; rdfs:domain kcc:DerivedAssertion ; "
      'rdfs:range xsd:string ; rdfs:label "derived relation" .')
    A("kcc:inducedSubjectLabel a owl:DatatypeProperty ; rdfs:domain kcc:DerivedAssertion ; "
      'rdfs:range xsd:string ; rdfs:label "derived subject" .')
    A("kcc:inducedObjectLabel a owl:DatatypeProperty ; rdfs:domain kcc:DerivedAssertion ; "
      'rdfs:range xsd:string ; rdfs:label "derived object" .')
    A("kcc:canonLinked a owl:DatatypeProperty ; rdfs:domain kcc:DerivedAssertion ; "
      'rdfs:range xsd:boolean ; rdfs:label "links a canon entity" .')
    A("")
    A("### Governance anchor — one Knowledge Context for the whole canon module")
    A("kcc:CanonKnowledgeContext a kc:KnowledgeContext ;")
    A('  rdfs:label "Noetica Knowledge Commons Canon Context" ;')
    A('  kc:schemaLabel "KNOWLEDGE_COMMONS_CANON_v1" ;')
    A('  kc:contextLabel "knowledge-commons-canon" .')
    A("")

    # ----------------------- ABox: domains/topics/terms/formulas -----------
    test_subjects: set[str] = set()

    for dom in DOMAINS:
        spec = specs.get(dom)
        if not spec:
            continue
        counts["domains"] += 1
        d_iri = domain_iri(dom)
        pro_cat = spec.get("mmlu_pro_category", "")
        A("### Domain: %s" % dom)
        A("%s a kcc:KnowledgeConcept ;" % d_iri)
        A("  skos:prefLabel %s ;" % lit(dom.replace("_", " ").title()))
        if pro_cat:
            A("  kcc:mmluProCategory %s ;" % lit(pro_cat))
        A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext ;")
        A("  skos:inScheme kcc:CanonScheme .")
        counts["concepts"] += 1

        for topic in spec.get("topics", []):
            tname = topic.get("topic", "")
            t_iri = topic_iri(dom, tname)
            A("%s a kcc:Topic ;" % t_iri)
            A("  skos:prefLabel %s ;" % lit(tname))
            lvl = topic.get("level")
            if lvl:
                A("  kcc:level %s ;" % lit(str(lvl)))
            A("  skos:broader %s ;" % d_iri)
            A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext ;")
            A("  skos:inScheme kcc:CanonScheme .")
            counts["topics"] += 1
            counts["concepts"] += 1

            # subtopics as scope notes on the topic
            subs = topic.get("subtopics", [])
            if subs:
                A("%s skos:scopeNote %s ." % (t_iri, lit("; ".join(subs))))

            # glossary terms -> GlossaryTerm concepts, broader the topic
            for g in topic.get("glossary", []):
                term = g.get("term", "")
                defn = g.get("definition", "")
                if not term:
                    continue
                gi = term_iri(dom, tname, term)
                A("%s a kcc:GlossaryTerm ;" % gi)
                A("  skos:prefLabel %s ;" % lit(term))
                A("  skos:definition %s ;" % lit(defn))
                A("  skos:broader %s ;" % t_iri)
                A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext ;")
                A("  skos:inScheme kcc:CanonScheme .")
                counts["concepts"] += 1

            # canon items -> Formula (equation-like) or a definition concept
            for c in topic.get("canon", []):
                name = c.get("name", "")
                form = c.get("form", "")
                ctype = (c.get("type") or "").lower()
                if not name:
                    continue
                if ctype in FORMULA_TYPES:
                    fi = formula_iri(dom, tname, name)
                    cls = "math:Equation" if dom == "mathematics" else "kcc:Formula"
                    A("%s a %s ;" % (fi, cls))
                    A("  rdfs:label %s ;" % lit(name))
                    A("  math:hasStatement %s ;" % lit(form))
                    A("  kcc:canonType %s ;" % lit(ctype))
                    A("  dct:subject %s ;" % t_iri)
                    A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext .")
                    counts["formulas"] += 1
                else:
                    # definitional canon -> a GlossaryTerm-style concept
                    ci = formula_iri(dom, tname, name)
                    A("%s a kcc:GlossaryTerm ;" % ci)
                    A("  skos:prefLabel %s ;" % lit(name))
                    if form:
                        A("  skos:definition %s ;" % lit(form))
                    A("  skos:broader %s ;" % t_iri)
                    A("  kcc:canonType %s ;" % lit(ctype or "definition"))
                    A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext ;")
                    A("  skos:inScheme kcc:CanonScheme .")
                    counts["concepts"] += 1
        A("")

    # ----------------------- ABox: seq2seq cards -> Formula (the mined equations, typed) --------------
    A("### Seq2seq cards — glossary-mined equations written back, typed as Formula (dct:source seq2seq)")
    for c in cards:
        if c.get("source") != "seq2seq":
            continue                                    # canon-sourced cards are already emitted from the specs
        dom = c.get("domain", "")
        tname = c.get("topic", "")
        front = (c.get("front") or "").split(":")[0].strip()
        back = c.get("back", "")
        if not (dom and tname and front and back):
            continue
        fi = formula_iri(dom, tname, "s2s-" + front)
        cls = "math:Equation" if dom == "mathematics" else "kcc:Formula"
        A("%s a %s ;" % (fi, cls))
        A("  rdfs:label %s ;" % lit(front))
        A("  math:hasStatement %s ;" % lit(back))
        A("  kcc:canonType %s ;" % lit("equation"))
        A('  dct:source "seq2seq" ;')
        A("  dct:subject %s ;" % topic_iri(dom, tname))
        A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext .")
        counts["cards"] += 1
    A("")

    # ----------------------- ABox: DERIVED knowledge -> DerivedAssertion, typed by EPISTEMIC MODE ----------
    A("### Derived knowledge — reified + typed by epistemic mode (deduced > induced > abduced)")
    nref = [0]

    def derived(subj, rel, obj, mode, source, linked):
        ai = f"<{KCC}derived-{nref[0]}-{slug(str(subj), str(rel), str(obj))[:44]}>"
        A("%s a kcc:DerivedAssertion ;" % ai)
        A("  kcc:inducedSubjectLabel %s ;" % lit(str(subj)))
        A("  kcc:inducedRelation %s ;" % lit(str(rel)))
        A("  kcc:inducedObjectLabel %s ;" % lit(str(obj)))
        A("  kcc:epistemicMode %s ;" % lit(mode))
        A("  kcc:canonLinked %s ;" % ('true' if linked else 'false'))
        A("  dct:source %s ;" % lit(source))
        A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext .")
        counts[mode] += 1
        nref[0] += 1

    for tr in induced:                                    # KGI frontier triples → INDUCED (generalized from data)
        s, r, o = tr.get("s"), tr.get("r"), tr.get("o")
        if s and r and o:
            derived(s, r, o, "induced", "kgi", bool(tr.get("s_canon") or tr.get("o_canon")))
    for e in lexical:                                     # compositional hyponymy → DEDUCED (rule, certain)
        if e.get("child") and e.get("parent"):
            derived(e["child"], "is_a", e["parent"], "deduced", "lexical-closure", True)
    for domain, v in (prereq.items() if isinstance(prereq, dict) else []):   # prereq DAG → ABDUCED (hypothesis)
        for ab in (v.get("edges") or []):
            if len(ab) == 2:
                derived(ab[0], "requires", ab[1], "abduced", "prereq-dag", True)
    for a in analogies:                                   # structural analogies → ABDUCED (proposed)
        if a.get("a") and a.get("b"):
            derived(a["a"], "analogous_to", a["b"], "abduced", "analogy", True)
    A("")

    # ----------------------- ABox: alignment / eval-anchoring --------------
    A("### Eval anchoring — MMLU / MMLU-Pro alignment (cosines preserved)")
    alignment = align.get("alignment", []) if isinstance(align, dict) else []

    # Pre-declare test subject concepts
    for a in alignment:
        for m in a.get("matches", []):
            test_subjects.add(m.get("subject", ""))
    test_subjects.discard("")
    for subj in sorted(test_subjects):
        si = subject_iri(subj)
        kind = "MMLU-Pro" if subj.startswith("pro:") else "MMLU"
        label = subj.split(":", 1)[-1].replace("_", " ")
        A("%s a kcc:TestSubject ;" % si)
        A("  skos:prefLabel %s ;" % lit(label))
        A("  skos:notation %s ;" % lit(subj))
        A("  dct:source %s ;" % lit(kind))
        A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext ;")
        A("  skos:inScheme kcc:CanonScheme .")
        counts["test_subjects"] += 1

    # alignment edges
    for a in alignment:
        dom = a.get("domain", "")
        tname = a.get("topic", "")
        if not dom or not tname:
            continue
        t_iri = topic_iri(dom, tname)
        for m in a.get("matches", []):
            subj = m.get("subject", "")
            cos = m.get("cos")
            if not subj or cos is None:
                continue
            si = subject_iri(subj)
            ei = align_iri(dom, tname, subj)
            rel = "skos:closeMatch" if cos >= GAP_THRESHOLD else "skos:relatedMatch"
            A("%s %s %s ." % (t_iri, rel, si))
            A("%s a kcc:AlignmentEdge ;" % ei)
            A("  kcc:alignsTopic %s ;" % t_iri)
            A("  kcc:alignsSubject %s ;" % si)
            A("  kcc:cosine \"%s\"^^xsd:decimal ;" % ("%.3f" % float(cos)))
            A("  kcc:inKnowledgeContext kcc:CanonKnowledgeContext .")
            counts["alignment_edges"] += 1

    A("")
    A("### Concept scheme")
    # NB: do NOT put kc:contextLabel here — its rdfs:domain is kc:KnowledgeContext,
    # which would retype the scheme as a KnowledgeContext and require kc:schemaLabel.
    A("kcc:CanonScheme a skos:ConceptScheme ;")
    A('  skos:prefLabel "Noetica Knowledge Commons Canon" ;')
    A('  skos:notation "knowledge-commons-canon" .')
    A("")

    # ── KBpedia entity grounding (symbol → RC → Wikidata) + CSKG commonsense edges, relation-typed to KKO ──
    A("### Entity grounding + CSKG commonsense edges — symbols bound to KBpedia RCs + Wikidata, edges typed to KKO")
    A('kcc:EntityGrounding a owl:Class ; rdfs:label "Entity grounding" ; rdfs:comment '
      '"Binds a canon symbol to its KBpedia reference concept + Wikidata entity + CSKG commonsense neighborhood." .')
    A('kcc:commonsenseEdge a owl:ObjectProperty ; rdfs:subPropertyOf kko:Predications ; '
      'rdfs:label "commonsense edge" ; rdfs:comment "A CSKG/ConceptNet relation (Secondness) to a neighbor concept." .')
    A('kcc:relationType a owl:DatatypeProperty ; rdfs:label "relation type" ; rdfs:comment "the CSKG/ConceptNet relation, e.g. /r/IsA, /r/Causes." .')
    try:
        _slug = lambda s: re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
        cdir = Path(__file__).resolve().parents[1] / "canon"
        grnd = json.loads((cdir / "symbol-grounding.json").read_text()) if (cdir / "symbol-grounding.json").exists() else {}
        cs = json.loads((cdir / "symbol-commonsense.json").read_text()) if (cdir / "symbol-commonsense.json").exists() else {}
        for sym, gv in grnd.items():
            gi = "kc:grounding-" + _slug(sym)
            A(f"{gi} a kcc:EntityGrounding ; rdfs:label {lit(sym)} .")
            if gv.get("kbpedia_rc"):
                A(f"{gi} skos:exactMatch <{gv['kbpedia_rc']}> .")
            if gv.get("wikidata"):
                A(f"{gi} owl:sameAs <http://www.wikidata.org/entity/{gv['wikidata']}> .")
        ne = 0
        for sym, cv in cs.items():
            gi = "kc:grounding-" + _slug(sym)
            for e in cv.get("commonsense_edges", [])[:20]:
                nb = e.get("neighbor_label") or e.get("target_label") or e.get("src_label")   # tolerate both edge formats
                if nb:
                    A(f"{gi} kcc:commonsenseEdge [ rdfs:label {lit(nb)} ; kcc:relationType {lit(e['rel'])} ] .")
                    ne += 1
        counts["grounded"] = len(grnd)
        counts["commonsense_edges"] = ne
        A("")
    except Exception:
        pass

    return "\n".join(out) + "\n", counts


# ---------------------------------------------------------------------------
# Emit module SHACL shapes (promotion gates for kcc: classes)
# ---------------------------------------------------------------------------
def emit_shapes() -> str:
    return f"""@base <{BASE}> .
@prefix kcc: <{KCC}> .
@prefix kc:  <{KC}> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix skos:<{SKOS}> .
@prefix math:<{MATH}> .
@prefix xsd: <{XSD}> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix dct: <{DCT}> .

<shapes/knowledge-commons-canon.shacl.ttl> a owl:Ontology ;
  dct:title "Knowledge Commons Canon SHACL Shapes" ;
  dct:description "Promotion-gate shapes for the Knowledge Commons Canon domain module." ;
  owl:versionInfo "0.1.0" .

# Every canon concept must carry a preferred label and live in the canon context.
kcc:KnowledgeConceptShape a sh:NodeShape ;
  sh:targetClass kcc:KnowledgeConcept ;
  sh:property [
    sh:path skos:prefLabel ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A canon concept must declare exactly one preferred label." ;
  ] ;
  sh:property [
    sh:path kcc:inKnowledgeContext ;
    sh:minCount 1 ;
    sh:class kc:KnowledgeContext ;
    sh:message "A canon concept must be bound to a governed Knowledge Context." ;
  ] .

# Topics must record a level.
kcc:TopicShape a sh:NodeShape ;
  sh:targetClass kcc:Topic ;
  sh:property [
    sh:path kcc:level ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A canon topic must declare exactly one level." ;
  ] .

# Glossary terms must carry a definition.
kcc:GlossaryTermShape a sh:NodeShape ;
  sh:targetClass kcc:GlossaryTerm ;
  sh:property [
    sh:path skos:definition ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A glossary term must declare a definition." ;
  ] .

# Formulas must carry a statement and the topic they belong to.
kcc:FormulaShape a sh:NodeShape ;
  sh:targetClass kcc:Formula ;
  sh:property [
    sh:path math:hasStatement ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A canon formula must declare its statement (form)." ;
  ] ;
  sh:property [
    sh:path dct:subject ;
    sh:minCount 1 ;
    sh:class kcc:Topic ;
    sh:message "A canon formula must be attached to a topic." ;
  ] .

# Alignment edges must preserve the cosine and both endpoints (eval-anchoring gate).
kcc:AlignmentEdgeShape a sh:NodeShape ;
  sh:targetClass kcc:AlignmentEdge ;
  sh:property [
    sh:path kcc:cosine ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:decimal ;
    sh:minInclusive 0.0 ;
    sh:maxInclusive 1.0 ;
    sh:message "An alignment edge must preserve a normalized cosine in [0,1]." ;
  ] ;
  sh:property [
    sh:path kcc:alignsTopic ;
    sh:minCount 1 ;
    sh:class kcc:Topic ;
    sh:message "An alignment edge must reference its canon topic." ;
  ] ;
  sh:property [
    sh:path kcc:alignsSubject ;
    sh:minCount 1 ;
    sh:class kcc:TestSubject ;
    sh:message "An alignment edge must reference its test subject." ;
  ] .

# Derived assertions must carry a relation, both endpoints, provenance, and a VALID epistemic mode — so no
# derived fact enters the governed graph without declaring whether it was deduced, induced, or abduced.
kcc:DerivedAssertionShape a sh:NodeShape ;
  sh:targetClass kcc:DerivedAssertion ;
  sh:property [
    sh:path kcc:epistemicMode ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:in ( "induced" "deduced" "abduced" ) ;
    sh:message "A derived assertion must declare exactly one epistemic mode: induced | deduced | abduced." ;
  ] ;
  sh:property [
    sh:path kcc:inducedRelation ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A derived assertion must declare exactly one relation." ;
  ] ;
  sh:property [
    sh:path kcc:inducedSubjectLabel ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A derived assertion must name its subject." ;
  ] ;
  sh:property [
    sh:path kcc:inducedObjectLabel ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:message "A derived assertion must name its object." ;
  ] ;
  sh:property [
    sh:path dct:source ;
    sh:minCount 1 ;
    sh:message "A derived assertion must declare its provenance (dct:source)." ;
  ] .
"""


# ---------------------------------------------------------------------------
# Emit JSON-LD context
# ---------------------------------------------------------------------------
def emit_context() -> str:
    ctx = {
        "@context": {
            "@version": 1.1,
            "kcc": KCC,
            "kc": KC,
            "math": MATH,
            "upper": UPPER,
            "skos": SKOS,
            "dct": DCT,
            "id": "@id",
            "type": "@type",
            "prefLabel": "skos:prefLabel",
            "definition": "skos:definition",
            "scopeNote": "skos:scopeNote",
            "notation": "skos:notation",
            "broader": {"@id": "skos:broader", "@type": "@id"},
            "narrower": {"@id": "skos:narrower", "@type": "@id"},
            "closeMatch": {"@id": "skos:closeMatch", "@type": "@id"},
            "relatedMatch": {"@id": "skos:relatedMatch", "@type": "@id"},
            "inScheme": {"@id": "skos:inScheme", "@type": "@id"},
            "level": "kcc:level",
            "mmluProCategory": "kcc:mmluProCategory",
            "canonType": "kcc:canonType",
            "hasStatement": "math:hasStatement",
            "subject": {"@id": "dct:subject", "@type": "@id"},
            "cosine": {"@id": "kcc:cosine", "@type": f"{XSD}decimal"},
            "alignsTopic": {"@id": "kcc:alignsTopic", "@type": "@id"},
            "alignsSubject": {"@id": "kcc:alignsSubject", "@type": "@id"},
            "inKnowledgeContext": {"@id": "kcc:inKnowledgeContext", "@type": "@id"},
            "schemaLabel": "kc:schemaLabel",
            "contextLabel": "kc:contextLabel",
        }
    }
    return json.dumps(ctx, indent=2) + "\n"


# ---------------------------------------------------------------------------
# Emit catalog registry supplement (TTL) and registry.jsonld patch entries
# ---------------------------------------------------------------------------
def emit_registry_ttl() -> str:
    return f"""@base <{BASE}> .
@prefix og: <{OG}> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dct: <{DCT}> .

<catalog/knowledge_commons_canon_registry.ttl> a owl:Ontology ;
  dct:title "Knowledge Commons Canon Registry Supplement" ;
  dct:description "Registry tranche for the Noetica canon -> ontogenesis bridge module." ;
  owl:versionInfo "0.1.0" ;
  owl:imports <catalog/registry.ttl> .

og:DomainKnowledgeCommonsCanon a og:Module ;
  og:layer "Domains" ;
  og:path "Domains/knowledge-commons-canon.ttl" ;
  og:baseIRI "{KCC}" ;
  og:semver "0.1.0" ;
  og:status "draft" ;
  rdfs:label "Knowledge Commons Canon domain" .

og:DomainKnowledgeCommonsCanonShapes a og:Module ;
  og:layer "SHACL" ;
  og:path "shapes/knowledge-commons-canon.shacl.ttl" ;
  og:baseIRI "{KCC}" ;
  og:semver "0.1.0" ;
  og:status "draft" ;
  rdfs:label "Knowledge Commons Canon SHACL gates" .

og:DomainKnowledgeCommonsCanonContext a og:Module ;
  og:layer "Contexts" ;
  og:path "contexts/knowledge-commons-canon.context.jsonld" ;
  og:baseIRI "{KCC}" ;
  og:semver "0.1.0" ;
  og:status "draft" ;
  rdfs:label "Knowledge Commons Canon JSON-LD context" .
"""


REGISTRY_TTL_ENTRY = """\
og:DomainKnowledgeCommonsCanon a og:Module ; og:layer "Domains" ; og:path "Domains/knowledge-commons-canon.ttl" ; og:baseIRI "https://socioprophet.github.io/ontogenesis/domains/knowledge-commons-canon#" ; og:semver "0.1.0" ; og:status "draft" ; rdfs:label "Knowledge Commons Canon domain" .
"""

REGISTRY_JSONLD_ENTRY = {
    "id": "https://socioprophet.github.io/ontogenesis/og#DomainKnowledgeCommonsCanon",
    "layer": "Domains",
    "path": "Domains/knowledge-commons-canon.ttl",
    "baseIRI": "https://socioprophet.github.io/ontogenesis/domains/knowledge-commons-canon#",
    "semver": "0.1.0",
    "status": "draft",
}


def patch_registry_ttl(reg_path: Path) -> bool:
    txt = reg_path.read_text()
    if "og:DomainKnowledgeCommonsCanon " in txt:
        return False
    # append before EOF (file is flat list of statements)
    if not txt.endswith("\n"):
        txt += "\n"
    txt += REGISTRY_TTL_ENTRY
    reg_path.write_text(txt)
    return True


def patch_registry_jsonld(reg_path: Path) -> bool:
    data = json.loads(reg_path.read_text())
    mods = data.get("modules", [])
    if any(m.get("id") == REGISTRY_JSONLD_ENTRY["id"] for m in mods):
        return False
    mods.append(REGISTRY_JSONLD_ENTRY)
    data["modules"] = mods
    reg_path.write_text(json.dumps(data, indent=2) + "\n")
    return True


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--canon", default=str(Path(__file__).resolve().parents[1] / "canon"))
    ap.add_argument("--ontogenesis", default=str(Path.home() / "dev" / "ontogenesis"))
    args = ap.parse_args()

    canon_dir = Path(args.canon).expanduser()
    onto = Path(args.ontogenesis).expanduser()
    if not onto.exists():
        raise SystemExit(f"ontogenesis repo not found: {onto}")

    specs, align, cards, induced, lexical, prereq, analogies = load_canon(canon_dir)
    if not specs:
        raise SystemExit(f"no spec-*.json found under {canon_dir}")

    module_ttl, counts = emit_module(specs, align, cards, induced, lexical, prereq, analogies)

    # WRITE THE MODULE FILE EARLY (before any further work) so partial work persists.
    mod_path = onto / "Domains" / "knowledge-commons-canon.ttl"
    mod_path.write_text(module_ttl)
    print(f"[write] {mod_path}  ({len(module_ttl)} bytes)")

    shapes_path = onto / "shapes" / "knowledge-commons-canon.shacl.ttl"
    shapes_path.write_text(emit_shapes())
    print(f"[write] {shapes_path}")

    ctx_path = onto / "contexts" / "knowledge-commons-canon.context.jsonld"
    ctx_path.write_text(emit_context())
    print(f"[write] {ctx_path}")

    reg_supp = onto / "catalog" / "knowledge_commons_canon_registry.ttl"
    reg_supp.write_text(emit_registry_ttl())
    print(f"[write] {reg_supp}")

    if patch_registry_ttl(onto / "catalog" / "registry.ttl"):
        print("[patch] catalog/registry.ttl  (+1 og:Module)")
    if patch_registry_jsonld(onto / "catalog" / "registry.jsonld"):
        print("[patch] catalog/registry.jsonld  (+1 module)")

    print("\n=== COUNTS ===")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
