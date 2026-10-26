import json
import math
from pathlib import Path

from build_tiles import BAG_SIZE, LOW_N, build
from kitaita_oracle import load_graphemes, tokenize

ROOT = Path(__file__).resolve().parent.parent


def toks(w):
    return [g.text for g in tokenize(w, load_graphemes())]


def test_tokenizer_splits_digraphs_and_ignores_apostrophe():
    assert toks("ng'ombe") == ["n", "g", "o", "m", "b", "e"]
    assert toks("Ng’ombe") == ["n", "g", "o", "m", "b", "e"]
    assert toks("ghamba") == ["g", "h", "a", "m", "b", "a"]
    assert toks("nyonyi") == ["n", "y", "o", "n", "y", "i"]


def test_unknown_characters_are_flagged_not_dropped():
    out = tokenize("café", load_graphemes())
    assert [g.known for g in out] == [True, True, True, False]


def test_tiles_reproducible_from_committed_stats():
    stats = json.loads((ROOT / "data" / "kitaita_corpus_stats.json").read_text())
    committed = json.loads((ROOT / "data" / "kitaita_tiles.json").read_text())
    assert build(stats, committed["frequency_basis"]) == committed


def test_tile_rules():
    t = json.loads((ROOT / "data" / "kitaita_tiles.json").read_text())
    tiles = [x for x in t["tiles"] if x["in_bag"]]
    assert sum(x["bag"] for x in tiles) == BAG_SIZE and all(x["bag"] >= 1 for x in tiles)
    assert all(1 <= x["score"] <= 10 for x in tiles)
    assert all(x["low_n"] == (x["count"] < LOW_N) for x in tiles)
    by_count = sorted(tiles, key=lambda x: -x["count"])
    assert [x["score"] for x in by_count] == sorted(x["score"] for x in by_count)  # rarer -> higher
    common = [x for x in tiles if not x["low_n"]]
    assert max(x["score"] for x in common) == 10
    assert t["blank"]["score"] == 0
    assert t["frequency_basis"] == "type" and t["n_word_types"] > 0 and t["corpus"]
    for x in t["tiles"]:
        if not x["in_bag"]:
            assert x["count"] == 0 and x["bag"] == 0 and x["score"] is None


def test_stats_contain_no_corpus_text():
    """Only aggregate counts: every key is a single grapheme, no words."""
    stats = json.loads((ROOT / "data" / "kitaita_corpus_stats.json").read_text())
    for table in ("type_counts", "token_counts", "unrecognized_characters_token_counts"):
        assert all(len(k) == 1 for k in stats[table])
    assert stats["n_word_types"] > 1000 and stats["corpus"]["sha256"]
