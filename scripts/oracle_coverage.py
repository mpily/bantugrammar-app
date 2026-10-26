#!/usr/bin/env python3
"""Oracle coverage on real Kitaita text (offline).

    python scripts/oracle_coverage.py /path/to/verses.jsonl [--sample 3000] [--seed 0]

Reports, with n:
  * verified-sentence words (speaker text from data/): share the oracle accepts
  * corpus word types (Bible text): share accepted, split by word type and reason
  * running text: share of ALL word tokens accepted (frequency-weighted)
  * control: the same corpus types with their letters shuffled. Accepted
    shuffles estimate how permissive the oracle is (over-generation).
Only aggregate numbers are printed; no corpus text is written anywhere.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from corpus_stats import WORD_RE, clean_verse  # noqa: E402
from kitaita_oracle import analyse  # noqa: E402


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return [round(c - h, 3), round(c + h, 3)]


def summarize(words, label):
    kinds, reasons, k = Counter(), Counter(), 0
    for w in words:
        r = analyse(w)
        if r["valid"]:
            k += 1
            kinds.update({p["word_type"] for p in r["parses"]})
        else:
            reasons[r["reason"]] += 1
    n = len(words)
    return {"set": label, "n": n, "accepted": k, "rate": round(k / n, 3) if n else None, "ci95": wilson(k, n),
            "accepted_by_word_type": dict(kinds), "rejected_by_reason": dict(reasons)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus", type=Path)
    ap.add_argument("--sample", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)
    rng = random.Random(args.seed)
    tokens = Counter()
    for line in args.corpus.read_text(encoding="utf-8").splitlines():
        if line.strip():
            tokens.update(WORD_RE.findall(clean_verse(json.loads(line)["text"])))
    types = sorted(t for t in tokens if len(t) >= 3)
    sample = rng.sample(types, min(args.sample, len(types)))
    shuffled = []
    for w in sample:
        letters = list(w)
        rng.shuffle(letters)
        shuffled.append("".join(letters))
    vocab = json.loads((ROOT / "data" / "verified_vocab.json").read_text(encoding="utf-8"))["items"]
    verified_words = sorted({w for it in vocab for w in it["kitaita"].lower().split()})
    k_tok = n_tok = 0
    for w, n in tokens.items():
        n_tok += n
        if analyse(w)["valid"]:
            k_tok += n
    report = {
        "running_text": {"tokens": n_tok, "accepted_tokens": k_tok, "rate": round(k_tok / n_tok, 3),
                         "note": "all word tokens (any length), weighted by frequency"},
        "corpus_types_total": len(types), "seed": args.seed,
        "results": [summarize(verified_words, "verified vocabulary words (speaker)"),
                    summarize(sample, f"corpus word types, random sample"),
                    summarize(shuffled, "control: same sample, letters shuffled")],
    }
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
