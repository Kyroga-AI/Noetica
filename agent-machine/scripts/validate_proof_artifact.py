#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import jsonschema


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--schema', required=True)
    parser.add_argument('--artifact', required=True)
    args = parser.parse_args()
    schema = json.loads(Path(args.schema).read_text(encoding='utf-8'))
    data = json.loads(Path(args.artifact).read_text(encoding='utf-8'))
    jsonschema.Draft202012Validator(schema).validate(data)
    print(f'validated ProofArtifact: {args.artifact}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
