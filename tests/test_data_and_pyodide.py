"""Data hygiene + Pyodide compatibility (import check)."""
import ast
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "kitaita_oracle"
ALLOWED_THIRD_PARTY = {"yaml"}


def test_oracle_imports_only_stdlib_and_pyyaml():
    stdlib = set(sys.stdlib_module_names)
    for f in PKG.glob("*.py"):
        for node in ast.walk(ast.parse(f.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                names = [node.module.split(".")[0]]
            for n in names:
                assert n in stdlib or n in ALLOWED_THIRD_PARTY, f"{f.name} imports {n}"
            assert not (isinstance(node, ast.Attribute) and node.attr in {"urlopen", "socket"}), f.name


def test_no_kitaita_forms_hard_coded_in_code():
    slots = yaml.safe_load((ROOT / "data" / "kitaita_verb_slots.yaml").read_text())
    forms = {m["form"] for items in slots["morphemes"].values() for m in items if len(m["form"]) >= 3}
    forms |= {"kund", "many", "kogh", "zamie", "ghenyi"}
    for f in PKG.glob("*.py"):
        literals = {n.value for n in ast.walk(ast.parse(f.read_text()))
                    if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        assert not (literals & forms), f"{f.name} hard-codes {literals & forms}"


def test_unverified_flags_are_booleans():
    for name in ["kitaita_verb_slots.yaml", "kitaita_phonology.yaml", "kitaita_roots.yaml", "kitaita_nouns.yaml",
                 "kitaita_adjectives.yaml", "kitaita_concord.yaml"]:
        def walk(x):
            if isinstance(x, dict):
                if "unverified" in x:
                    assert isinstance(x["unverified"], bool), name
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(yaml.safe_load((ROOT / "data" / name).read_text()))


def test_phonology_rules_unverified_unless_sourced_to_a_speaker_table():
    rules = yaml.safe_load((ROOT / "data" / "kitaita_phonology.yaml").read_text())["rules"]
    for r in rules:
        assert "unverified" in r and r.get("source")
        if not r["unverified"]:
            assert "CONFIRMED" in r["source"] or "verified" in r["source"].lower()


def test_corpus_items_are_unverified():
    roots = yaml.safe_load((ROOT / "data" / "kitaita_roots.yaml").read_text())["roots"]
    assert all(r["unverified"] for r in roots if r["source"] == "corpus")
    nouns = yaml.safe_load((ROOT / "data" / "kitaita_nouns.yaml").read_text())["nouns"]
    assert all(n["unverified"] for n in nouns if n["sources"] == ["corpus"])
