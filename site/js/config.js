// Single place for deployment configuration.
export const API_BASE = "https://mpily-bantugrammar.hf.space";
export const API_VERSION = "1";

// Pyodide (pinned) for the in-browser oracle; loaded only when the Scrabble tab opens.
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

// Files written into Pyodide's filesystem. Paths are relative to the site root
// (scripts/build_site.sh copies kitaita_oracle/ and data/ next to index.html).
export const ORACLE_PY_FILES = [
  "kitaita_oracle/__init__.py",
  "kitaita_oracle/graphemes.py",
  "kitaita_oracle/oracle.py",
  "kitaita_oracle/tables.py",
  "kitaita_oracle/verbs.py",
];
export const ORACLE_DATA_FILES = [
  "data/kitaita_adjectives.yaml",
  "data/kitaita_closed_class.yaml",
  "data/kitaita_concord.yaml",
  "data/kitaita_graphemes.yaml",
  "data/kitaita_nouns.yaml",
  "data/kitaita_phonology.yaml",
  "data/kitaita_roots.yaml",
  "data/kitaita_verb_slots.yaml",
  "data/swahili_phonology.yaml",
  "data/swahili_roots.yaml",
  "data/swahili_verb_slots.yaml",
];
export const TILES_URL = "data/kitaita_tiles.json";
export const VERIFIED_VOCAB_URL = "data/verified_vocab.json";

export const MACHINE_LABEL = "machine translation — awaiting native-speaker review";
