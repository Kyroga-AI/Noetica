from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

@dataclass(frozen=True)
class QueryLimits:
    max_hops: int = 2
    max_limit: int = 200
    max_exec_ms: int = 500
    max_paths: int = 5000

@dataclass(frozen=True)
class Settings:
    backend: str = "lite"  # lite | opencog
    policy_path: Optional[str] = None
    limits: QueryLimits = QueryLimits()

def _int_env(key: str, default: int) -> int:
    v = os.getenv(key)
    if v is None or v == "":
        return default
    try:
        return int(v)
    except ValueError:
        return default

def load_settings() -> Settings:
    policy_path = os.getenv("CY_GATEWAY_POLICY_PATH")
    backend = os.getenv("CY_GATEWAY_BACKEND", "lite").strip()

    limits = QueryLimits(
        max_hops=_int_env("CY_GATEWAY_MAX_HOPS", 2),
        max_limit=_int_env("CY_GATEWAY_MAX_LIMIT", 200),
        max_exec_ms=_int_env("CY_GATEWAY_MAX_EXEC_MS", 500),
        max_paths=_int_env("CY_GATEWAY_MAX_PATHS", 5000),
    )

    # Policy YAML (optional)
    if policy_path:
        try:
            data = yaml.safe_load(Path(policy_path).read_text(encoding="utf-8")) or {}
            ql = (data.get("query_limits") or {})
            limits = QueryLimits(
                max_hops=int(ql.get("max_hops", limits.max_hops)),
                max_limit=int(ql.get("max_limit", limits.max_limit)),
                max_exec_ms=int(ql.get("max_exec_ms", limits.max_exec_ms)),
                max_paths=int(ql.get("max_paths", limits.max_paths)),
            )
        except Exception:
            # Policy parse failure must not crash the gateway; defaults remain.
            pass

    return Settings(backend=backend, policy_path=policy_path, limits=limits)
