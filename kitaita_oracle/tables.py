"""Locating and loading the data tables (standard library + PyYAML only).

Lookup order for the data directory:
  1. an explicit `data_dir` argument
  2. the KITAITA_ORACLE_DATA environment variable
  3. `data/` next to this package (a checkout of this repo, or the page)
  4. the `kitaita_oracle.data` package installed from the wheel
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import yaml

try:  # libyaml is ~10x faster when present; Pyodide may not have it
    _Loader = yaml.CSafeLoader
except AttributeError:  # pragma: no cover
    _Loader = yaml.SafeLoader


def data_dir(explicit=None) -> Path:
    if explicit:
        return Path(explicit)
    env = os.environ.get("KITAITA_ORACLE_DATA")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent.parent / "data"
    if (here / "kitaita_verb_slots.yaml").exists():
        return here
    import importlib
    pkg = importlib.import_module("kitaita_oracle.data")  # data/ installed as a namespace package
    return Path(next(iter(pkg.__path__)))


@lru_cache(maxsize=None)
def _load(path: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix == ".json":
        return json.loads(text)
    return yaml.load(text, Loader=_Loader)


def load_yaml(name: str, explicit_dir=None):
    return _load(str(data_dir(explicit_dir) / name))
