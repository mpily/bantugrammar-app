#!/usr/bin/env python3
"""Letter frequencies -> tile scores and bag counts (offline, deterministic).

    python scripts/build_tiles.py            # reads data/kitaita_corpus_stats.json
                                             # writes data/kitaita_tiles.json

score  = clip(round(k * ln(f_max / f)), 1, 10), f = TYPE count (default;
         token counts over-weight a few function words). k is set so the
         rarest grapheme with count >= LOW_N lands on 10.
bag    = BAG_SIZE letter tiles proportional to f (largest remainder),
         at least 1 per grapheme that occurs; plus BLANKS blank tiles (score 0).
low_n  = count < LOW_N: flagged, still scored by the same formula.
Graphemes with count 0 get no tiles (`in_bag: false`).
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOW_N = 20
BAG_SIZE = 100
BLANKS = 2
MAX_SCORE = 10


def build(stats: dict, basis: str = "type") -> dict:
    counts = stats[f"{basis}_counts"]
    import yaml
    inv = yaml.safe_load((ROOT / "data" / "kitaita_graphemes.yaml").read_text(encoding="utf-8"))
    graphemes = inv["graphemes"]
    f = {g: counts.get(g, 0) for g in graphemes}
    present = [g for g in graphemes if f[g] > 0]
    common = [g for g in present if f[g] >= LOW_N]
    f_max = max(f[g] for g in present)
    f_min_common = min(f[g] for g in common)
    k = MAX_SCORE / math.log(f_max / f_min_common)

    total = sum(f[g] for g in present)
    quota = {g: BAG_SIZE * f[g] / total for g in present}
    bag = {g: max(1, math.floor(quota[g])) for g in present}
    remainder_order = sorted(present, key=lambda g: (-(quota[g] - math.floor(quota[g])), g))
    i = 0
    while sum(bag.values()) < BAG_SIZE:
        bag[remainder_order[i % len(remainder_order)]] += 1
        i += 1
    while sum(bag.values()) > BAG_SIZE:  # min-1 floors can overshoot: take from the largest
        big = max(present, key=lambda g: (bag[g], g))
        bag[big] -= 1

    tiles = []
    for g in graphemes:
        if f[g] == 0:
            tiles.append({"grapheme": g, "count": 0, "frequency": 0.0, "score": None, "bag": 0,
                          "in_bag": False, "low_n": True})
            continue
        score = min(MAX_SCORE, max(1, round(k * math.log(f_max / f[g]))))
        tiles.append({"grapheme": g, "count": f[g], "frequency": round(f[g] / total, 5), "score": score,
                      "bag": bag[g], "in_bag": True, "low_n": f[g] < LOW_N})
    return {
        "tile_set_version": f"{inv['version']}+{basis}-counts",
        "grapheme_inventory_version": inv["version"],
        "corpus": stats["corpus"]["name"],
        "corpus_sha256": stats["corpus"]["sha256"],
        "corpus_n_verses": stats["corpus"]["n_verses"],
        "n_word_types": stats["n_word_types"],
        "n_word_tokens": stats["n_word_tokens"],
        "frequency_basis": basis,
        "n_graphemes_counted": total,
        "date": stats["generated"],
        "formula": "score = clip(round(k * ln(f_max / f)), 1, 10)",
        "k": round(k, 4), "low_n_threshold": LOW_N, "bag_size": BAG_SIZE,
        "blank": {"score": 0, "bag": BLANKS},
        "tiles": tiles,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", type=Path, default=ROOT / "data" / "kitaita_corpus_stats.json")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "kitaita_tiles.json")
    ap.add_argument("--basis", choices=["type", "token"], default="type")
    args = ap.parse_args(argv)
    stats = json.loads(args.stats.read_text(encoding="utf-8"))
    out = build(stats, args.basis)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(" ".join(f"{t['grapheme']}={t['score']}x{t['bag']}" for t in out["tiles"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
