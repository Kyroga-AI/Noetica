"""
Parse a HellGraph Atomese dump (s-expressions) and load it into AtomSpaceLite.

HellGraph's dumpAtomese() emits top-level atoms as Atomese s-expressions:
  (ConceptNode "urn:regis:feature-atom:react")
  (EvaluationLink
    (PredicateNode "COOCCURS_WITH")
    (ListLink
      (ConceptNode "urn:regis:feature-atom:react")
      (ConceptNode "urn:regis:feature-atom:typescript")))

We extract ConceptNode names and EvaluationLink triples and load them
into AtomSpaceLite so Cypher queries work without OpenCog.
"""
from __future__ import annotations

from typing import Any, List, Optional, Tuple

from cypher_gw.base import Edge
from cypher_gw.lite import AtomSpaceLite

# ─── Tokenizer ────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> List[str]:
    tokens: List[str] = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in ' \t\n\r':
            i += 1
        elif c in '()':
            tokens.append(c)
            i += 1
        elif c == '"':
            j = i + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                elif text[j] == '"':
                    j += 1
                    break
                else:
                    j += 1
            tokens.append(text[i:j])
            i = j
        elif c == ';':
            while i < n and text[i] != '\n':
                i += 1
        else:
            j = i
            while j < n and text[j] not in ' \t\n\r()':
                j += 1
            tokens.append(text[i:j])
            i = j
    return tokens


# ─── Parser ───────────────────────────────────────────────────────────────────

# A form is (head, tv_or_None, children)
# tv is (strength, confidence)
Form = Tuple[str, Optional[Tuple[float, float]], List[Any]]


class _Parser:
    def __init__(self, tokens: List[str]) -> None:
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> Optional[str]:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def next(self) -> str:
        t = self.tokens[self.pos]
        self.pos += 1
        return t

    def parse_all(self) -> List[Form]:
        forms: List[Form] = []
        while self.peek() is not None:
            if self.peek() == '(':
                f = self.parse_form()
                if f is not None:
                    forms.append(f)
            else:
                self.next()
        return forms

    def parse_form(self) -> Optional[Form]:
        if self.peek() != '(':
            return None
        self.next()  # consume (
        if self.peek() is None or self.peek() == ')':
            if self.peek() == ')':
                self.next()
            return None
        head = self.next()
        tv: Optional[Tuple[float, float]] = None
        children: List[Any] = []
        while self.peek() is not None and self.peek() != ')':
            if self.peek() == '(':
                # peek ahead for (stv s c)
                if (self.pos + 1 < len(self.tokens)
                        and self.tokens[self.pos + 1] == 'stv'):
                    self.next()  # (
                    self.next()  # stv
                    try:
                        s = float(self.next())
                        c = float(self.next())
                        tv = (s, c)
                    except (ValueError, IndexError):
                        pass
                    if self.peek() == ')':
                        self.next()
                else:
                    child = self.parse_form()
                    if child is not None:
                        children.append(child)
            else:
                children.append(self.next())
        if self.peek() == ')':
            self.next()
        return (head, tv, children)


# ─── Extractor ────────────────────────────────────────────────────────────────

def _unquote(s: str) -> str:
    if s.startswith('"') and s.endswith('"'):
        return s[1:-1].replace('\\"', '"').replace('\\\\', '\\')
    return s


def _extract(form: Form) -> Tuple[List[str], List[Edge]]:
    head, tv, children = form
    concepts: List[str] = []
    edges: List[Edge] = []

    if head == 'ConceptNode':
        if children and isinstance(children[0], str):
            concepts.append(_unquote(children[0]))

    elif head == 'EvaluationLink':
        # Find PredicateNode and ListLink children
        pred: Optional[str] = None
        frm: Optional[str] = None
        to: Optional[str] = None
        strength = tv[0] if tv else 1.0
        confidence = tv[1] if tv else 1.0

        for child in children:
            if not isinstance(child, tuple):
                continue
            c_head, c_tv, c_children = child
            if c_head == 'PredicateNode' and c_children and isinstance(c_children[0], str):
                pred = _unquote(c_children[0])
            elif c_head == 'ListLink':
                concept_forms = [
                    c for c in c_children
                    if isinstance(c, tuple) and c[0] == 'ConceptNode'
                ]
                if len(concept_forms) >= 2:
                    fc, tc = concept_forms[0], concept_forms[1]
                    if fc[2] and isinstance(fc[2][0], str):
                        frm = _unquote(fc[2][0])
                    if tc[2] and isinstance(tc[2][0], str):
                        to = _unquote(tc[2][0])

        if pred and frm and to:
            edges.append(Edge(
                head=frm, relation=pred, tail=to,
                strength=strength, confidence=confidence,
            ))
            concepts.extend([frm, to])

    # Recurse into sub-forms
    for child in children:
        if isinstance(child, tuple):
            sub_c, sub_e = _extract(child)
            concepts.extend(sub_c)
            edges.extend(sub_e)

    return concepts, edges


# ─── Public API ───────────────────────────────────────────────────────────────

def load_atomese(store: AtomSpaceLite, atomese: str) -> int:
    """Parse an Atomese dump and upsert all concepts and edges into the store."""
    if not atomese or not atomese.strip():
        return 0
    tokens = _tokenize(atomese)
    parser = _Parser(tokens)
    forms = parser.parse_all()

    all_concepts: List[str] = []
    all_edges: List[Edge] = []
    for form in forms:
        c, e = _extract(form)
        all_concepts.extend(c)
        all_edges.extend(e)

    added = store.upsert_concepts(all_concepts)
    added += store.upsert_edges(all_edges)
    return added
