from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .config import Settings
from .limits import ExecBudget, enforce_limits
from .base import AtomStore, Edge

class ExecutionError(RuntimeError):
    pass

def execute_plan(store: AtomStore, settings: Settings, plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    if plan.get("op") != "expand":
        raise ExecutionError(f"unsupported op: {plan.get('op')}")

    hop_min, hop_max = plan["edge"]["hops"]
    limit = int(plan.get("limit", 25))

    hop_min, hop_max, limit = enforce_limits(settings.limits, (hop_min, hop_max), limit)

    start_form = plan["from"]["props"]["form"]
    relation_filter = plan["edge"].get("relation")

    budget = ExecBudget(start=__import__("time").monotonic(), max_exec_ms=settings.limits.max_exec_ms)
    # The store enforces its own timing, but we also check budget around calls.
    budget.check()

    paths = store.expand_paths(
        start=str(start_form),
        hop_min=hop_min,
        hop_max=hop_max,
        relation_filter=str(relation_filter) if relation_filter else None,
        max_paths=min(settings.limits.max_paths, limit),
        max_exec_ms=settings.limits.max_exec_ms,
    )

    rows: List[Dict[str, Any]] = []
    head_var = plan["from"]["var"]
    tail_var = plan["to"]["var"]
    path_var = plan.get("path_var")

    for p in paths[:limit]:
        if budget:
            budget.check()
        # Build variable bindings
        nodes = [str(start_form)]
        for e in p:
            nodes.append(e.tail)
        bindings = {head_var: str(start_form), tail_var: nodes[-1]}
        if path_var:
            bindings[path_var] = "__path__"

        # Evaluate return items
        row: Dict[str, Any] = {}
        for item in plan["return"]:
            typ = item["type"]
            expr = item.get("expr") or f"{typ}"
            if typ == "prop":
                var = item["var"]
                prop = item["prop"]
                if prop != "form":
                    raise ExecutionError("only .form is supported in this subset")
                if var not in bindings:
                    raise ExecutionError(f"unknown variable in RETURN: {var}")
                row[expr] = bindings[var]
            elif typ == "nodes":
                # nodes(pathvar) returns node forms along the path
                row[expr] = nodes
            elif typ == "rels":
                # relationships(pathvar) returns edge dicts
                row[expr] = [
                    {"head": e.head, "relation": e.relation, "tail": e.tail, "strength": e.strength, "confidence": e.confidence, "source": e.source}
                    for e in p
                ]
            else:
                raise ExecutionError(f"unsupported RETURN item: {typ}")
        rows.append(row)

    return rows
