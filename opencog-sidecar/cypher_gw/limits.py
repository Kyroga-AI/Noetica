from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional, Tuple

from .config import QueryLimits

class QueryLimitError(ValueError):
    pass

@dataclass
class ExecBudget:
    start: float
    max_exec_ms: int

    def check(self) -> None:
        elapsed_ms = (time.monotonic() - self.start) * 1000.0
        if elapsed_ms > self.max_exec_ms:
            raise QueryLimitError(f"query execution exceeded max_exec_ms={self.max_exec_ms} (elapsed={elapsed_ms:.1f}ms)")

def enforce_limits(
    limits: QueryLimits,
    hop_range: Tuple[int, int],
    limit: int,
) -> Tuple[int, int, int]:
    hop_min, hop_max = hop_range
    if hop_min < 1:
        raise QueryLimitError("hop_min must be >= 1")
    if hop_max < hop_min:
        raise QueryLimitError("hop_max must be >= hop_min")
    if hop_max > limits.max_hops:
        raise QueryLimitError(f"hop_max={hop_max} exceeds max_hops={limits.max_hops}")
    if limit <= 0:
        raise QueryLimitError("LIMIT must be > 0")
    if limit > limits.max_limit:
        raise QueryLimitError(f"LIMIT={limit} exceeds max_limit={limits.max_limit}")
    return hop_min, hop_max, limit
