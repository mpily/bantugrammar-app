#!/usr/bin/env python3
"""data/kitaita_concord.yaml -> JSON list of noun classes for the review page's
class picker (the page has no YAML parser). Run by scripts/build_site.sh:

    python3 scripts/build_class_list.py > _site/data/kitaita_classes.json
"""
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def class_list() -> list[dict]:
    classes = yaml.safe_load((ROOT / "data" / "kitaita_concord.yaml").read_text(encoding="utf-8"))["classes"]
    return [{"id": cid, "nearest_swahili_class": c.get("nearest_swahili_class"), "number": c.get("number"),
             "subject_marker": (c.get("subject_marker") or {}).get("form"),
             "examples": (c.get("sample_members") or [])[:4]}
            for cid, c in sorted(classes.items())]


if __name__ == "__main__":
    json.dump({"classes": class_list()}, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
