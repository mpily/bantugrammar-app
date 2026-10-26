#!/usr/bin/env python3
"""Letter-frequency statistics from a local Kitaita corpus (offline).

    python scripts/corpus_stats.py /path/to/verses.jsonl

Writes data/kitaita_corpus_stats.json: per-grapheme counts over word TYPES
and word TOKENS, with corpus size n. Only aggregate counts are written. The
corpus text itself (a published Bible translation) is never committed.

Cleaning, in order: drop the leading verse number; drop cross-references
(everything from " # " on); NFC + lowercase; apostrophes removed (tile
decision 2026-10-26: ignore them); words = maximal runs of letters
(hyphens, digits and punctuation split words). Proper names are not
removed: there is no reliable way to tell them apart in sentence-initial
position.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from kitaita_oracle.graphemes import load_graphemes, tokenize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
APOSTROPHES = "'’‘ʼ`"
WORD_RE = re.compile(r"[^\W\d_]+")


def clean_verse(text: str) -> str:
    text = re.sub(r"^\s*\d+[a-z]?\s+", "", text)
    text = text.split(" # ")[0]
    text = unicodedata.normalize("NFC", text).lower()
    for a in APOSTROPHES:
        text = text.replace(a, "")
    return text


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus", type=Path, help="verses.jsonl (fields: text, abbr, version_id)")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "kitaita_corpus_stats.json")
    ap.add_argument("--date", required=True, help="date stamp written into the output (YYYY-MM-DD)")
    args = ap.parse_args(argv)

    raw = args.corpus.read_bytes()
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    tokens = Counter()
    for r in rows:
        tokens.update(WORD_RE.findall(clean_verse(r["text"])))

    inventory = load_graphemes()
    type_counts, token_counts, other = Counter(), Counter(), Counter()
    for word, n in tokens.items():
        for g in tokenize(word, inventory):
            if g.known:
                type_counts[g.text] += 1
                token_counts[g.text] += n
            else:
                other[g.text] += n
    abbrs = sorted({r.get("abbr") for r in rows if r.get("abbr")})
    versions = sorted({str(r.get("version_id")) for r in rows if r.get("version_id")})
    out = {
        "corpus": {
            "name": "Kitaita (Kidaw'ida) Bible, verses.jsonl supplied by the project owner",
            "abbr": abbrs, "version_id": versions, "n_verses": len(rows),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "note": "Published Bible translation: only aggregate counts are stored here.",
        },
        "generated": args.date,
        "cleaning": __doc__.split("Cleaning, in order:")[1].strip().replace("\n", " "),
        "grapheme_inventory_version": inventory.version,
        "n_word_tokens": sum(tokens.values()),
        "n_word_types": len(tokens),
        "n_grapheme_tokens_over_types": sum(type_counts.values()),
        "n_grapheme_tokens_over_tokens": sum(token_counts.values()),
        "type_counts": dict(sorted(type_counts.items())),
        "token_counts": dict(sorted(token_counts.items())),
        "unrecognized_characters_token_counts": dict(other.most_common()),
    }
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(rows)} verses, {out['n_word_tokens']} tokens, {out['n_word_types']} types -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
