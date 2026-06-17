from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import DefaultDict, Dict, List, Optional, Sequence, Set, Tuple

from .base import AtomStore, Edge

class AtomSpaceLite(AtomStore):
    """A small, in-memory AtomSpace-like store.

    This is NOT OpenCog AtomSpace; it is a pragmatic stand-in so we can:
    - ingest ConceptNet/ATOMIC slices today,
    - run Cypher façade queries deterministically,
    - write conformance tests,
    - then swap in a real OpenCog-backed adapter later.

    Data model:
      Concept: string 'form'
      Relation: Edge(head, relation, tail, strength, confidence)
    """

    def __init__(self):
        self._nodes: Set[str] = set()
        self._edges: Dict[Tuple[str, str, str], Edge] = {}
        self._outgoing: DefaultDict[str, List[Edge]] = defaultdict(list)

    def _rebuild_outgoing(self) -> None:
        self._outgoing = defaultdict(list)
        for e in self._edges.values():
            self._outgoing[e.head].append(e)

    def upsert_concepts(self, concepts: Sequence[str]) -> int:
        n0 = len(self._nodes)
        for c in concepts:
            if c is None:
                continue
            c = str(c)
            if c != "":
                self._nodes.add(c)
        return len(self._nodes) - n0

    def upsert_edges(self, edges: Sequence[Edge]) -> int:
        new_count = 0
        for e in edges:
            key = (e.head, e.relation, e.tail)
            if key not in self._edges:
                new_count += 1
                self._edges[key] = e
            else:
                # Merge policy: keep the edge with higher confidence; if tie, higher strength.
                old = self._edges[key]
                if (e.confidence, e.strength) > (old.confidence, old.strength):
                    self._edges[key] = e
            self._nodes.add(e.head)
            self._nodes.add(e.tail)
        self._rebuild_outgoing()
        return new_count

    def expand_paths(
        self,
        start: str,
        hop_min: int,
        hop_max: int,
        relation_filter: Optional[str],
        max_paths: int,
        max_exec_ms: int,
    ) -> List[List[Edge]]:
        start = str(start)
        t0 = time.monotonic()

        def timed_out() -> bool:
            return (time.monotonic() - t0) * 1000.0 > max_exec_ms

        paths: List[List[Edge]] = []
        if start not in self._nodes:
            return paths

        # BFS queue: (path_edges, current_node, visited_nodes)
        q = deque()
        q.append( ([], start, {start}) )

        while q:
            if timed_out():
                break
            path, node, visited = q.popleft()
            depth = len(path)
            if depth >= hop_max:
                continue

            for e in self._outgoing.get(node, []):
                if relation_filter and e.relation != relation_filter:
                    continue
                if e.tail in visited:
                    continue  # prevent cycles within a path
                new_path = path + [e]
                new_visited = set(visited)
                new_visited.add(e.tail)

                new_depth = depth + 1
                if new_depth >= hop_min:
                    paths.append(new_path)
                    if len(paths) >= max_paths:
                        return paths

                if new_depth < hop_max:
                    q.append( (new_path, e.tail, new_visited) )

        return paths

    # Debug helpers
    def stats(self) -> dict:
        return {"nodes": len(self._nodes), "edges": len(self._edges)}
