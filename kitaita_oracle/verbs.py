"""Data-driven Bantu verb parser.

The engine knows nothing about Kitaita or Swahili. Everything comes from:

  <lang>_verb_slots.yaml  morpheme inventories per slot + paradigms
  <lang>_phonology.yaml   ordered morphophonological rules
  <lang>_roots.yaml       roots (without final vowel)

A *paradigm* is a licensed co-occurrence bundle: an ordered list of slots,
each with the morphemes it allows (or optional), plus the final vowels it
allows. Parsing generates every licensed prefix chain once, applies the
phonology to get its surface strings, and indexes them. A word is a verb
when it splits into  indexed prefix + known root + (EXT*) + licensed FV.
Any licensed chain combines with ANY root: validity comes from the slot
rules, never from a list of attested inflected forms.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field

from .tables import load_yaml

VOWEL_DEFAULT = "aeiou"


@dataclass
class Morph:
    slot: str
    form: str           # surface form after phonology
    underlying: str
    morpheme: dict | None  # None for ROOT/FV


@dataclass
class Chain:
    paradigm: dict
    morphemes: list[dict]          # chosen morphemes in slot order (prefix part only)


@dataclass
class Realization:
    chain: Chain
    morphs: list[Morph]            # prefix morphs with surface forms
    rules: list[dict] = field(default_factory=list)

    @property
    def surface(self) -> str:
        return "".join(m.form for m in self.morphs)


class VerbGrammar:
    def __init__(self, lang: str, data_dir=None):
        prefix = {"dav": "kitaita", "swh": "swahili"}[lang]
        self.lang = lang
        self.slots_data = load_yaml(f"{prefix}_verb_slots.yaml", data_dir)
        self.phon = load_yaml(f"{prefix}_phonology.yaml", data_dir)
        roots = load_yaml(f"{prefix}_roots.yaml", data_dir)["roots"]
        self.roots: dict[str, dict] = {}
        for r in roots:
            self.roots.setdefault(r["root"], r)
        self.template: list[str] = self.slots_data["template"]
        self.vowels = self.phon.get("vowels", VOWEL_DEFAULT)
        self.inventory: dict[str, list[dict]] = {}
        self.by_id: dict[str, dict] = {}
        for slot, items in self.slots_data["morphemes"].items():
            for m in items or []:
                m = dict(m)
                m["_slot"] = "+".join(m["slots"]) if "slots" in m else slot
                self.inventory.setdefault(m["_slot"], []).append(m)
                if m["id"] in self.by_id:
                    raise ValueError(f"duplicate morpheme id {m['id']}")
                self.by_id[m["id"]] = m
        self.paradigms: list[dict] = self.slots_data["paradigms"]
        self.rules = sorted((r for r in self.phon.get("rules", []) if r.get("enabled", True)),
                            key=lambda r: r["order"])
        self._check_template_order()
        self._index: dict[str, dict[str, list[Realization]]] = {}

    # ------------------------------------------------------------------ setup
    def _slot_position(self, slot_label: str) -> int:
        return self.template.index(slot_label.split("+")[0])

    def _check_template_order(self) -> None:
        for p in self.paradigms:
            positions = [self._slot_position(s["slot"]) for s in p["sequence"]]
            if positions != sorted(positions):
                raise ValueError(f"paradigm {p['id']} violates the template order {self.template}")
            for fv in p["fv"]:
                if fv not in self.by_id:
                    raise ValueError(f"paradigm {p['id']}: unknown FV id {fv}")

    def _choose(self, step: dict) -> list[dict]:
        slot = step["slot"]
        pool = self.inventory.get(slot, [])
        choose = step["choose"]
        if choose == "all":
            return list(pool)
        out = []
        for c in choose:
            if isinstance(c, str):
                if c not in self.by_id:
                    raise ValueError(f"unknown morpheme id {c}")
                out.append(self.by_id[c])
            else:
                out += [m for m in pool if all(m.get(k) in v for k, v in c.items())]
        return out

    def chains(self):
        for p in self.paradigms:
            options = []
            for step in p["sequence"]:
                opts = self._choose(step)
                if step.get("optional"):
                    opts = [None] + opts
                options.append(opts)
            for combo in itertools.product(*options):
                yield Chain(p, [m for m in combo if m is not None])

    # ------------------------------------------------------------------ phonology
    def _char_class(self, ch: str) -> str:
        return "vowel" if ch and ch in self.vowels else "consonant"

    def _rule_applies(self, rule: dict, chain: Chain, morphs: list[Morph], i: int, next_char: str) -> bool:
        m = morphs[i]
        if m.slot != rule["target"] or not m.form:
            return False
        w = rule.get("when", {})
        tags = set(chain.paradigm.get("tags", []))
        if "tags" in w and not set(w["tags"]) <= tags:
            return False
        if "kind" in w and (m.morpheme or {}).get("kind") not in w["kind"]:
            return False
        if "forms" in w and m.form not in w["forms"]:
            return False
        if "left_ends" in w and self._char_class(m.form[-1]) != w["left_ends"]:
            return False
        if "right_starts" in w and self._char_class(next_char) != w["right_starts"]:
            return False
        t = rule["type"]
        if t == "replace_form":
            return m.form in rule["table"]
        if t == "replace_final":
            return m.form[-1] in rule["table"]
        return t == "insert_after"

    @staticmethod
    def _apply(rule: dict, m: Morph) -> Morph:
        t = rule["type"]
        if t == "replace_form":
            form = rule["table"][m.form]
        elif t == "replace_final":
            form = m.form[:-1] + rule["table"][m.form[-1]]
        else:
            form = m.form + rule["insert"]
        return Morph(m.slot, form, m.underlying, m.morpheme)

    def realize(self, chain: Chain, root_initial: str, obligatory_only: bool = False) -> list[Realization]:
        start = [Morph(m["_slot"], m["form"], m["form"], m) for m in chain.morphemes]
        variants = [Realization(chain, start, [])]
        for rule in self.rules:
            if obligatory_only and rule.get("optional"):
                continue
            new = []
            for var in variants:
                morphs, applied = list(var.morphs), list(var.rules)
                changed = False
                for i in range(len(morphs)):
                    nxt = next((mm.form for mm in morphs[i + 1:] if mm.form), None)
                    next_char = nxt[0] if nxt else root_initial
                    if self._rule_applies(rule, chain, morphs, i, next_char):
                        morphs[i] = self._apply(rule, morphs[i])
                        changed = True
                if changed:
                    new.append(Realization(chain, morphs, applied + [rule]))
                    if rule.get("optional"):
                        new.append(var)
                else:
                    new.append(var)
            variants = new
        return variants

    def _prefix_index(self, root_initial_class: str) -> dict[str, list[Realization]]:
        if root_initial_class not in self._index:
            probe = self.vowels[0] if root_initial_class == "vowel" else "k"
            idx: dict[str, list[Realization]] = {}
            for chain in self.chains():
                for real in self.realize(chain, probe):
                    idx.setdefault(real.surface, []).append(real)
            self._index[root_initial_class] = idx
        return self._index[root_initial_class]

    # ------------------------------------------------------------------ parsing
    def _ext_fv_splits(self, rest: str, fv_ids: list[str]):
        """Yield (root, [ext morphemes], fv morpheme) for rest = root + EXT* + FV."""
        exts = self.inventory.get("EXT", [])
        for fv_id in fv_ids:
            fv = self.by_id[fv_id]
            if not rest.endswith(fv["form"]):
                continue
            body = rest[: len(rest) - len(fv["form"])]
            stack = [(body, [])]
            while stack:
                b, chosen = stack.pop()
                yield b, list(reversed(chosen)), fv
                if len(chosen) < 2:
                    for e in exts:
                        if e["form"] and b.endswith(e["form"]):
                            stack.append((b[: -len(e["form"])], chosen + [e]))

    def parse(self, word: str) -> list[dict]:
        word = word.lower()
        parses = []
        for p in range(0, len(word)):
            rest = word[p:]
            idx = self._prefix_index(self._char_class(rest[0]))
            for real in idx.get(word[:p], []):
                for root, exts, fv in self._ext_fv_splits(rest, real.chain.paradigm["fv"]):
                    entry = self.roots.get(root)
                    if entry is None or not root:
                        continue
                    parses.append(self._describe(word, real, entry, exts, fv))
        return parses

    def _describe(self, word, real: Realization, root: dict, exts, fv) -> dict:
        slots = []
        unverified = []
        for m in real.morphs:
            mm = m.morpheme
            s = {"slot": m.slot, "form": m.form, "gloss": mm.get("gloss")}
            if m.underlying != m.form:
                s["underlying"] = m.underlying
            if mm.get("unverified"):
                s["unverified"] = True
                unverified.append(f"{m.slot} {mm['id']}")
            slots.append(s)
        root_slot = {"slot": "ROOT", "form": root["root"], "gloss": _root_gloss(root)}
        if root.get("unverified"):
            root_slot["unverified"] = True
            unverified.append(f"ROOT {root['root']}")
        slots.append(root_slot)
        for e in exts:
            slots.append({"slot": "EXT", "form": e["form"], "gloss": e.get("gloss")})
            if e.get("unverified"):
                unverified.append(f"EXT {e['id']}")
        fv_slot = {"slot": "FV", "form": fv["form"], "gloss": fv.get("gloss")}
        if fv.get("unverified"):
            fv_slot["unverified"] = True
            unverified.append(f"FV {fv['id']}")
        slots.append(fv_slot)
        for r in real.rules:
            if r.get("unverified"):
                unverified.append(f"rule {r['id']}")
        if real.chain.paradigm.get("unverified"):
            unverified.append(f"paradigm {real.chain.paradigm['id']}")
        return {
            "word_type": "verb",
            "paradigm": real.chain.paradigm["id"],
            "slots": slots,
            "rules_applied": [r["id"] for r in real.rules],
            "uses_unverified_rules": bool(unverified),
            "unverified_items": unverified,
            "_chain": real.chain, "_root": root, "_fv": fv,
        }

    def prefix_candidates(self, word: str) -> list[tuple[str, str, dict]]:
        """(prefix, rest, paradigm) for every licensed prefix the word starts with
        whose remainder ends in a licensed FV (used for the unknown_root reason)."""
        out = []
        for p in range(1, len(word)):
            rest = word[p:]
            for real in self._prefix_index(self._char_class(rest[0])).get(word[:p], []):
                for fv_id in real.chain.paradigm["fv"]:
                    f = self.by_id[fv_id]["form"]
                    if rest.endswith(f) and len(rest) - len(f) >= 2:
                        out.append((word[:p], rest, real.chain.paradigm))
        return out

    def known_root_endings(self, word: str) -> list[str]:
        """Known roots (3+ letters) the word ends with, followed by any FV."""
        fvs = {m["form"] for m in self.inventory.get("FV", [])}
        hits = []
        for f in fvs:
            if word.endswith(f):
                body = word[: len(word) - len(f)]
                for i in range(1, len(body) - 2):
                    if body[i:] in self.roots:
                        hits.append(body[i:])
        return hits

    # ------------------------------------------------------------------ generation
    def generate(self, root: str, obligatory_only: bool = False) -> list[dict]:
        """Every surface form licensed for `root` (productivity check)."""
        out = []
        for chain in self.chains():
            for real in self.realize(chain, root[0], obligatory_only):
                for fv_id in chain.paradigm["fv"]:
                    out.append({"surface": real.surface + root + self.by_id[fv_id]["form"],
                                "paradigm": chain.paradigm["id"],
                                "morphemes": [m["id"] for m in chain.morphemes], "fv": fv_id})
        return out

    SLOT_GROUPS = {"SM": "subject", "TAM": "tense", "OM": "object", "NEG": "negative", "NEG2": "negative",
                   "REL": "relative"}

    def realize_features(self, tags: set[str], wants: dict[str, dict], root: str) -> list[str]:
        """Surface forms in THIS language for a feature bundle, e.g.
        tags={'affirmative','present'}, wants={'subject': {'person': '1sg'},
        'tense': {'tense': 'present'}, 'object': {'class': '9'}}. Used to give the
        Swahili equivalent of a Kitaita parse. Obligatory phonology only."""
        out = []
        for p in self.paradigms:
            if set(p.get("tags", [])) != set(tags):
                continue
            options, ok = [], True
            for step in p["sequence"]:
                want = {}
                groups = [self.SLOT_GROUPS.get(part) for part in step["slot"].split("+")]
                present = [g for g in groups if g in wants]
                for g in present:
                    want.update(wants[g])
                if not present:
                    if step.get("optional"):
                        options.append([None])
                        continue
                    ok = False
                    break
                cands = [m for m in self._choose(step) if _matches(m, want)]
                if not cands:
                    ok = False
                    break
                options.append(cands)
            if not ok:
                continue
            for combo in itertools.product(*options):
                chain = Chain(p, [m for m in combo if m is not None])
                for real in self.realize(chain, root[0], obligatory_only=True):
                    out.append(real.surface + root + self.by_id[p["fv"][0]]["form"])
        return sorted(set(out))


def _matches(morpheme: dict, want: dict) -> bool:
    """Every feature the morpheme carries must be wanted, with the same value."""
    feats = morpheme.get("features") or {}
    return bool(feats) and all(k in want and str(want[k]) == str(v) for k, v in feats.items())


def _root_gloss(root: dict) -> str | None:
    sw = root.get("swahili") or []
    if isinstance(sw, str):
        sw = [sw]
    return ("Sw. -" + "/-".join(sw)) if sw else root.get("note")
