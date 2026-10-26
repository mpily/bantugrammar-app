#!/usr/bin/env python3
"""Find verb roots in a Kitaita corpus using the oracle's own grammar (offline).

    python scripts/induce_roots.py /path/to/verses.jsonl [--min-prefixes 3] [--min-strong 2]

For every corpus word type in the TRAIN half (see oracle_coverage.split_half),
strip each licensed prefix chain and final vowel; what remains is a candidate
root. A candidate is kept only if it occurs after several DIFFERENT licensed
prefixes, i.e. it behaves productively like a verb root:

  * >= min_prefixes distinct prefix surfaces, and
  * >= min_strong of them are "strong": they contain a tense/aspect marker,
    the infinitive ku- or negation. A bare subject marker alone (u-, i-, wa-)
    is weak evidence: noun class prefixes look the same.

Output: data/kitaita_roots_induced.yaml (all rows unverified: true, no gloss:
the corpus says the string is a root, not what it means). Curated roots in
kitaita_roots.yaml always take precedence. Only roots and counts are written,
never corpus text.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from corpus_stats import WORD_RE, clean_verse  # noqa: E402
from oracle_coverage import split_half  # noqa: E402
from kitaita_oracle.verbs import VerbGrammar  # noqa: E402

STRONG_SLOTS = {"TAM", "NEG", "SM+TAM", "NEG+SM+TAM", "NEG+SM"}


def is_strong(real) -> bool:
    for m in real.morphs:
        mm = m.morpheme or {}
        if m.slot in STRONG_SLOTS and m.form:
            return True
        if mm.get("kind") == "infinitive":
            return True
    return False


def candidates(word: str, g: VerbGrammar, min_len: int):
    for p in range(1, len(word) - min_len):
        rest = word[p:]
        for real in g._prefix_index(g._char_class(rest[0])).get(word[:p], []):
            for fv_id in real.chain.paradigm["fv"]:
                fv = g.by_id[fv_id]["form"]
                if rest.endswith(fv) and len(rest) - len(fv) >= min_len:
                    yield rest[: len(rest) - len(fv)], word[:p], is_strong(real)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus", type=Path)
    ap.add_argument("--min-prefixes", type=int, default=3)
    ap.add_argument("--min-strong", type=int, default=2)
    ap.add_argument("--min-len", type=int, default=3)
    ap.add_argument("--max-affix", type=int, default=3,
                    help="drop a candidate that is an accepted/known root plus <= this many extra letters on one side")
    ap.add_argument("--half", choices=["train", "all"], default="train")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "kitaita_roots_induced.yaml")
    ap.add_argument("--date", required=True)
    args = ap.parse_args(argv)

    tokens = Counter()
    for line in args.corpus.read_text(encoding="utf-8").splitlines():
        if line.strip():
            tokens.update(WORD_RE.findall(clean_verse(json.loads(line)["text"])))
    words = [w for w in tokens if args.half == "all" or split_half(w) == "train"]

    g = VerbGrammar("dav")
    # curated roots only: never feed a previous induction run back in
    g.roots = {r["root"]: r for r in yaml.safe_load((ROOT / "data" / "kitaita_roots.yaml").read_text())["roots"]}
    prefixes, strong, word_types, freq = defaultdict(set), defaultdict(set), defaultdict(set), Counter()
    for w in words:
        for cand, prefix, is_s in candidates(w, g, args.min_len):
            if not cand.isalpha():
                continue
            prefixes[cand].add(prefix)
            if is_s:
                strong[cand].add(prefix)
            word_types[cand].add(w)
            freq[cand] += tokens[w]

    def qualifies(c):
        return len(prefixes[c]) >= args.min_prefixes and len(strong[c]) >= args.min_strong

    # Shortest first: a longer candidate that is an accepted (or curated) root plus a few
    # letters on one side is almost always root + an unmodelled affix (object marker m-,
    # suffix -agh-, ...), not a new root.
    accepted: list[str] = []
    dropped = Counter()
    known = set(g.roots)
    om_forms = {m["form"] for m in g.inventory.get("OM", []) if m["form"]}
    ext_forms = [m["form"] for m in g.inventory.get("EXT", []) if m["form"]]
    # suffix strings an unparsed candidate can carry: up to 3 extensions + a partial ending
    tails = {""}
    for _ in range(3):
        tails |= {t + e for t in tails for e in ext_forms}
    tails |= {t + x for t in list(tails) for x in ("egh", "iegh", "ogh", "agh")}

    def om_root_ext(c: str, base: set) -> bool:
        """c == (OM) + known root + (extension sequence), with at least one affix."""
        for om in [""] + sorted(om_forms):
            if not c.startswith(om):
                continue
            body = c[len(om):]
            for t in tails:
                r = body[: len(body) - len(t)] if t else body
                if (om or t) and len(r) >= args.min_len and body.endswith(t) and r in base:
                    return True
        return False
    affix_strings = tails | {om + t for om in om_forms for t in tails}
    for cand in sorted((c for c in prefixes if qualifies(c) and c not in g.roots), key=lambda c: (len(c), c)):
        if cand in affix_strings:  # e.g. 'egh', 'agh': suffix fragments, not roots
            dropped["affix_fragment"] += 1
            continue
        # e.g. 'any' vs known 'many' = m + any: keep whichever reading has more prefix evidence
        if any(om + cand in known and len(prefixes.get(om + cand, ())) >= len(prefixes[cand]) for om in om_forms):
            dropped["known_root_minus_marker"] += 1
            continue
        base = known | set(accepted)
        composite = any(
            (cand.endswith(r) and 0 < len(cand) - len(r) <= args.max_affix) or
            (cand.startswith(r) and 0 < len(cand) - len(r) <= args.max_affix)
            for r in base if len(r) >= args.min_len)
        composite = composite or om_root_ext(cand, base)
        if composite:
            dropped["root_plus_affix"] += 1
            continue
        accepted.append(cand)
    rows = [{"root": c, "unverified": True, "source": "corpus_induction",
             "n_prefixes": len(prefixes[c]), "n_strong_prefixes": len(strong[c]),
             "n_word_types": len(word_types[c]), "n_tokens": freq[c],
             "example_prefixes": sorted(prefixes[c], key=len)[:6]} for c in sorted(accepted)]
    print(f"dropped: {dict(dropped)}")
    header = (f"# Kitaita verb roots INDUCED from the Bible corpus by scripts/induce_roots.py on {args.date}.\n"
              f"# half={args.half}, min_prefixes={args.min_prefixes}, min_strong={args.min_strong}, "
              f"min_len={args.min_len}, max_affix={args.max_affix}; {len(words)} word types scanned.\n"
              "# A root is kept only if it follows several different licensed prefixes. No glosses: the\n"
              "# corpus shows the string behaves like a root, not what it means. All rows are unverified.\n")
    doc = {"sources": {"corpus_induction": "paradigm induction over the Kitaita Bible corpus (not speaker-checked)"},
           "settings": {"half": args.half, "min_prefixes": args.min_prefixes, "min_strong": args.min_strong,
                        "min_len": args.min_len, "max_affix": args.max_affix, "word_types_scanned": len(words)},
           "roots": rows}
    args.out.write_text(header + yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=100), encoding="utf-8")
    print(f"{len(rows)} induced roots from {len(words)} word types -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
