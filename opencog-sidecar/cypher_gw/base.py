from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

@dataclass(frozen=True)
class Edge:
    head: str
    relation: str
    tail: str
    strength: float = 1.0
    confidence: float = 1.0
    source: Optional[str] = None

@dataclass(frozen=True)
class UpsertResult:
    concepts_upserted: int
    edges_upserted: int

class AtomStore(ABC):
    @abstractmethod
    def upsert_concepts(self, concepts: Sequence[str]) -> int:
        ...

    @abstractmethod
    def upsert_edges(self, edges: Sequence[Edge]) -> int:
        ...

    @abstractmethod
    def expand_paths(
        self,
        start: str,
        hop_min: int,
        hop_max: int,
        relation_filter: Optional[str],
        max_paths: int,
        max_exec_ms: int,
    ) -> List[List[Edge]]:
        """Return paths as lists of edges."""
        ...
