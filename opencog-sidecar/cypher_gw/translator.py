from __future__ import annotations

from typing import Any, Dict, Tuple

class TranslationError(ValueError):
    pass

def _resolve_value(v: Any, params: Dict[str, Any]) -> Any:
    # v may be string literal, ("param", name), ("ident", name)
    if isinstance(v, tuple) and len(v) == 2:
        kind, name = v
        if kind == "param":
            return params.get(name)
        if kind == "ident":
            return name
    return v

def plan_from_ast(ast: Dict[str, Any], params: Dict[str, Any]) -> Dict[str, Any]:
    match = ast["match"]
    pat = match

    m = match["head"] if "head" in match else match["match"]["head"]  # defensive
    # Actually parse_cypher returns {"match": {"path_var":..., "head":..., "chain":...}, "return":..., "limit":...}
    pat = ast["match"]
    head = pat["head"]
    chain = pat["chain"]
    path_var = pat.get("path_var")

    # Restrict to single rel segment (rel + node)
    if len(chain) != 2:
        raise TranslationError("only a single relationship segment is supported in this Cypher subset")

    rel = chain[0]
    tail = chain[1]

    head_props = {k: _resolve_value(v, params) for k, v in (head.get("props") or {}).items()}
    tail_props = {k: _resolve_value(v, params) for k, v in (tail.get("props") or {}).items()}

    hop_min, hop_max = 1, 1
    if rel.get("range"):
        hop_min, hop_max = rel["range"]

    relation_filter = None
    if rel.get("props") and "relation" in rel["props"]:
        relation_filter = _resolve_value(rel["props"]["relation"], params)

    limit = int(ast.get("limit", 25))

    plan = {
        "op": "expand",
        "path_var": path_var,
        "from": {"var": head.get("var"), "label": head.get("label"), "props": head_props},
        "edge": {"type": rel.get("type"), "relation": relation_filter, "hops": (hop_min, hop_max), "props": rel.get("props") or {}},
        "to": {"var": tail.get("var"), "label": tail.get("label"), "props": tail_props},
        "return": ast["return"],
        "limit": limit,
    }

    # Basic sanity requirements
    if not plan["from"]["var"]:
        raise TranslationError("head node variable is required, e.g. (h:Concept {...})")
    if not plan["to"]["var"]:
        raise TranslationError("tail node variable is required, e.g. (t)")
    if "form" not in plan["from"]["props"]:
        # We could allow other keys, but our CSKG canonical key is form
        raise TranslationError("head node must specify {form: ...} for CSKG expansions")
    return plan
