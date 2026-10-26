"""analyse(word) -> is it a valid Kitaita word, and every analysis.

Word types (all returned when several match):
  noun       dictionary lookup only (data/kitaita_nouns.yaml)
  demonstrative / possessive / associative / function_word
             dictionary lookup only (data/kitaita_closed_class.yaml)
  adjective  concord prefix (data/kitaita_concord.yaml) + stem (data/kitaita_adjectives.yaml)
  verb       slot-template parse (verbs.py + data/kitaita_verb_slots.yaml)

Invalid words get a `reason`:
  illegal_affix_sequence  ends in a known root/stem, but the material before it is not licensed
  unknown_root            licensed verb prefixes + final vowel, but the root is not in the root list
  not_in_dictionary       anything else (e.g. a noun we don't have)
"""
from __future__ import annotations

import itertools
import unicodedata

from .tables import load_yaml
from .verbs import VerbGrammar

_APOS = str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "`": "'"})


def normalize_word(word: str) -> str:
    return unicodedata.normalize("NFC", word or "").translate(_APOS).strip().lower()


class Oracle:
    def __init__(self, data_dir=None):
        self.data_dir = data_dir
        self.verbs = {"dav": VerbGrammar("dav", data_dir)}
        self.concord = load_yaml("kitaita_concord.yaml", data_dir)["classes"]
        self.nouns: dict[str, list[dict]] = {}
        for n in load_yaml("kitaita_nouns.yaml", data_dir)["nouns"]:
            self.nouns.setdefault(normalize_word(n["form"]), []).append(n)
        self.adj_stems = load_yaml("kitaita_adjectives.yaml", data_dir)["stems"]
        self.closed: dict[str, list[dict]] = {}
        for c in load_yaml("kitaita_closed_class.yaml", data_dir)["words"]:
            self.closed.setdefault(normalize_word(c["form"]), []).append(c)

    def swahili_grammar(self) -> VerbGrammar:
        if "swh" not in self.verbs:
            self.verbs["swh"] = VerbGrammar("swh", self.data_dir)
        return self.verbs["swh"]

    # ------------------------------------------------------------------ public
    def analyse(self, word: str, lang: str = "dav") -> dict:
        w = normalize_word(word)
        if lang == "swh":
            parses = [self._public(p) for p in self.swahili_grammar().parse(w)] if w else []
            return {"word": word, "lang": lang, "valid": bool(parses), "parses": parses,
                    "reason": None if parses else self._verb_reason(w, self.swahili_grammar())}
        if lang != "dav":
            raise ValueError(f"unsupported lang {lang!r} (dav or swh)")
        parses = []
        if w:
            parses += self._nouns(w)
            parses += self._closed_class(w)
            parses += self._adjectives(w)
            for p in self.verbs["dav"].parse(w):
                p["swahili_equivalents"] = self._swahili_equivalents(p)
                p["swahili_equivalent"] = p["swahili_equivalents"][0] if p["swahili_equivalents"] else None
                parses.append(self._public(p))
        return {"word": word, "lang": lang, "valid": bool(parses), "parses": parses,
                "reason": None if parses else self._reason(w)}

    # ------------------------------------------------------------------ nouns
    def _nouns(self, w: str) -> list[dict]:
        out = []
        for n in self.nouns.get(w, []):
            unverified = []
            if n.get("unverified"):
                unverified.append("noun entry (corpus-aligned)")
            if n.get("class") and n.get("class_unverified"):
                unverified.append("noun class")
            # only speaker-given glosses (`swahili`); alignment guesses (`swahili_unverified`) are hidden
            gloss = ", ".join(n.get("swahili") or []) or None
            out.append({"word_type": "noun", "slots": [{"slot": "NOUN", "form": n["form"], "gloss": gloss}],
                        "class": n.get("class"), "number": n.get("number"),
                        "swahili_equivalent": (n.get("swahili") or [None])[0],
                        "uses_unverified_rules": bool(unverified), "unverified_items": unverified})
        return out

    # ------------------------------------------------------------------ closed class
    def _closed_class(self, w: str) -> list[dict]:
        out = []
        for c in self.closed.get(w, []):
            items = [f"{c['category']} entry"] if c.get("unverified") else []
            out.append({"word_type": c["category"], "slots": [{"slot": c["category"].upper(), "form": c["form"],
                                                               "gloss": c.get("gloss")}],
                        "class": c.get("class"), "swahili_equivalent": c.get("gloss"),
                        "uses_unverified_rules": bool(items), "unverified_items": items})
        return out

    # ------------------------------------------------------------------ adjectives
    def _adj_prefixes(self, series: str) -> dict[str, list[tuple[str, dict]]]:
        """prefix -> [(class id, prefix entry)] for one series."""
        out: dict[str, list[tuple[str, dict]]] = {}
        for cid, c in self.concord.items():
            for pe in (c.get("adjective_prefixes") or {}).get(series, []):
                out.setdefault(pe["form"], []).append((cid, pe))
        return out

    def _adjectives(self, w: str) -> list[dict]:
        out = []
        for st in self.adj_stems:
            stem = st["stem"]
            # attested irregular forms are accepted as listed
            for cid, f in (st.get("forms") or {}).items():
                if not f.get("regular") and normalize_word(f["form"]) == w:
                    out.append(self._adj_parse(w, st, None, [cid], f.get("unverified", True), irregular=True))
            if not w.endswith(stem) or len(w) == len(stem):
                continue
            prefix = w[: -len(stem)]
            series_list = [st["series"]] if st["series"] in ("A", "B") else ["A", "B"]
            for series in series_list:
                hits = self._adj_prefixes(series).get(prefix, [])
                if hits:
                    out.append(self._adj_parse(
                        w, st, prefix, [cid for cid, _ in hits],
                        any(pe.get("unverified") for _, pe in hits) or st.get("unverified") or st["series"] == "unknown"))
        # one parse per (stem, prefix): dedupe the irregular/regular overlap
        seen, uniq = set(), []
        for p in out:
            key = (p["slots"][-1]["form"], p["slots"][0]["form"] if len(p["slots"]) > 1 else "")
            if key not in seen:
                seen.add(key)
                uniq.append(p)
        return uniq

    def _adj_parse(self, w, st, prefix, classes, unverified: bool, irregular=False) -> dict:
        items = []
        if unverified:
            items.append(f"adjective -{st['stem']} ({'irregular form' if irregular else 'prefix/stem'})")
        slots = ([{"slot": "ADJ", "form": w, "gloss": f"irregular form of -{st['stem']}"}] if irregular else
                 [{"slot": "CONCORD", "form": prefix, "gloss": "class " + "/".join(classes)},
                  {"slot": "STEM", "form": st["stem"], "gloss": f"Sw. -{st['swahili']}"}])
        if irregular:
            slots.append({"slot": "STEM", "form": st["stem"], "gloss": f"Sw. -{st['swahili']}"})
        return {"word_type": "adjective", "slots": slots, "agrees_with_classes": classes,
                "swahili_equivalent": f"-{st['swahili']}", "uses_unverified_rules": unverified,
                "unverified_items": items}

    # ------------------------------------------------------------------ verbs: swahili equivalent
    def _swahili_equivalents(self, parse: dict) -> list[str]:
        chain, root, fv = parse["_chain"], parse["_root"], parse["_fv"]
        if root.get("unverified"):
            return []  # the Swahili side of an unverified root is an alignment guess: don't show it
        tags = {t for t in chain.paradigm.get("tags", []) if t in ("affirmative", "negative", "infinitive")}
        wants_options: list[dict] = [{}]
        for m in chain.morphemes:
            feats = m.get("swahili") or {}
            slot = m["_slot"]
            groups: dict[str, dict] = {}
            for k, v in feats.items():
                if k == "tense":
                    tags.add(v)
                    groups.setdefault("tense", {})["tense"] = v
                elif k == "negative":
                    groups.setdefault("negative", {})["negative"] = v
                elif slot == "OM":
                    groups.setdefault("object", {})[k] = v
                else:
                    groups.setdefault("subject", {})[k] = v
            new_opts = []
            for opt in wants_options:
                # a class like "4, 9" is ambiguous: try each
                variants = [groups]
                for g, d in groups.items():
                    if "class" in d and d["class"] and "," in str(d["class"]):
                        variants = [{**groups, g: {**d, "class": c.strip()}} for c in str(d["class"]).split(",")]
                for var in variants:
                    merged = {k: dict(v) for k, v in opt.items()}
                    for g, d in var.items():
                        merged.setdefault(g, {}).update(d)
                    new_opts.append(merged)
            wants_options = new_opts
        if any(None in d.values() for opt in wants_options for d in opt.values()):
            return []
        sw_roots = root.get("swahili") or []
        if isinstance(sw_roots, str):
            sw_roots = [sw_roots]
        if "negative" in tags:
            for opt in wants_options:
                opt.setdefault("negative", {"negative": True})
        sw = self.swahili_grammar()
        out = []
        for opt, sw_root in itertools.product(wants_options, sw_roots):
            out += sw.realize_features(tags, opt, sw_root)
        return sorted(set(out))

    # ------------------------------------------------------------------ reasons
    def _reason(self, w: str) -> str:
        if self.verbs["dav"].known_root_endings(w):
            return "illegal_affix_sequence"
        for st in self.adj_stems:
            if len(st["stem"]) >= 3 and w.endswith(st["stem"]) and len(w) > len(st["stem"]):
                return "illegal_affix_sequence"
        return self._verb_reason(w, self.verbs["dav"])

    @staticmethod
    def _verb_reason(w: str, grammar: VerbGrammar) -> str:
        if grammar.known_root_endings(w):
            return "illegal_affix_sequence"
        if grammar.prefix_candidates(w):
            return "unknown_root"
        return "not_in_dictionary"

    @staticmethod
    def _public(p: dict) -> dict:
        return {k: v for k, v in p.items() if not k.startswith("_")}


_DEFAULT: Oracle | None = None


def get_oracle(data_dir=None) -> Oracle:
    global _DEFAULT
    if data_dir is not None:
        return Oracle(data_dir)
    if _DEFAULT is None:
        _DEFAULT = Oracle()
    return _DEFAULT


def analyse(word: str, lang: str = "dav", data_dir=None) -> dict:
    return get_oracle(data_dir).analyse(word, lang)
