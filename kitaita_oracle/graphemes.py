"""Grapheme (tile) tokenizer: longest match over the inventory in
data/kitaita_graphemes.yaml. Characters in `ignore_characters` (apostrophes)
are dropped; anything else outside the inventory comes back as an unknown
token rather than being silently dropped or guessed."""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from .tables import load_yaml


@dataclass(frozen=True)
class Inventory:
    version: str
    graphemes: tuple[str, ...]
    ignore: frozenset[str]

    @property
    def longest(self) -> int:
        return max(len(g) for g in self.graphemes)


@dataclass(frozen=True)
class Grapheme:
    text: str
    known: bool


def load_graphemes(data_dir=None) -> Inventory:
    d = load_yaml("kitaita_graphemes.yaml", data_dir)
    return Inventory(version=str(d["version"]), graphemes=tuple(d["graphemes"]),
                     ignore=frozenset(d.get("ignore_characters", [])))


def tokenize(word: str, inventory: Inventory) -> list[Grapheme]:
    word = unicodedata.normalize("NFC", word).lower()
    word = "".join(c for c in word if c not in inventory.ignore)
    known = set(inventory.graphemes)
    out, i = [], 0
    while i < len(word):
        for n in range(min(inventory.longest, len(word) - i), 0, -1):
            piece = word[i:i + n]
            if piece in known:
                out.append(Grapheme(piece, True))
                i += n
                break
        else:
            out.append(Grapheme(word[i], False))
            i += 1
    return out
