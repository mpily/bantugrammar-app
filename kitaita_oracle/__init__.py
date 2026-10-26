"""Kitaita marker-oracle: is a word valid Kitaita, and every analysis.

Pure Python (standard library + PyYAML), no network, Pyodide-compatible.
All Kitaita forms come from data/ tables, never from code.

    from kitaita_oracle import analyse
    analyse("wawemanya")            # Kitaita (dav)
    analyse("ninaipenda", "swh")    # the parallel Swahili parser
"""
from .graphemes import load_graphemes, tokenize
from .oracle import Oracle, analyse, get_oracle, normalize_word

__all__ = ["analyse", "Oracle", "get_oracle", "normalize_word", "tokenize", "load_graphemes"]
__version__ = "0.1.0"
