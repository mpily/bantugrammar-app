# Kitaita Learning Lab (bantugrammar-app)

**Machine translation for a language with almost no data, made honest by native speakers.**

A static web page (GitHub Pages, no server) for Kitaita (Kidaw'ida, ISO `dav`):

| Tab | What it does | Where the work happens |
|---|---|---|
| **Translate** | Swahili → Kitaita, with a status badge, the agreement decisions behind each prefix, and a 1–5 rating + correction form | The research Space API ([mpily/BantuGrammar](https://github.com/mpily/BantuGrammar), contract in [`docs/space_api.md`](docs/space_api.md)) |
| **Progress** | Ratings, agreement with speakers, verified-pair counts, always with n and low-n flags | Computed by the Space |
| **Drills** | Type the Kitaita (or Swahili) for speaker-verified pairs; graded in the browser | `/api/verified_pairs` + [`data/verified_vocab.json`](data/verified_vocab.json) |
| **Scrabble** | Checks a word with the marker-oracle and scores it with letter-frequency tiles | [`kitaita_oracle/`](kitaita_oracle/), in the browser via Pyodide |
| **Word Race** (`game.html`) | Multiplayer, skribbl-style: share a room link, everyone gets the same tiles, make Kitaita words; vote to accept words the checker rejects | Rooms run on the Space (WebSocket); words checked there by the same oracle |

Nothing unverified is presented as correct: translator output is labelled
*machine translation — awaiting native-speaker review*, words the pipeline
couldn't translate are marked, drills use verified pairs only, and Scrabble
underlines any part of an analysis that relies on unverified grammar data.

## The demo story

Translate a sentence and see why each prefix changed → a speaker rates and
corrects it (web or SMS) → the Progress tab updates → once two speakers agree,
the sentence is promoted to *verified* → it shows up in a learner drill → the
oracle validates and scores a Scrabble word built from the same morphology.

## The marker-oracle

```python
pip install "git+https://github.com/mpily/bantugrammar-app"

from kitaita_oracle import analyse
analyse("wawemanya")
# valid: verb  wa-we-many-a  (SM.u fused for present + PRES + root 'many' + FV), ≈ Sw. "anajua"
analyse("ninaipenda", lang="swh")   # the parallel Swahili parser
```

- **Nouns and closed-class words** (demonstratives, possessives, "of" particles,
  function words): dictionary lookup only.
- **Adjectives:** class concord prefix + known stem; any class's prefix goes with any stem of the right series.
- **Verbs:** slot template `(NEG) SM (NEG2) TAM (REL) (OM) ROOT (EXT*) FV`. Allowed
  combinations ("paradigms") and morphophonological rules are data
  ([`data/kitaita_verb_slots.yaml`](data/kitaita_verb_slots.yaml),
  [`data/kitaita_phonology.yaml`](data/kitaita_phonology.yaml)). Any licensed prefix chain
  attaches to **any** root in [`data/kitaita_roots.yaml`](data/kitaita_roots.yaml);
  nothing is validated against a list of attested forms.
- Invalid words come back with a reason: `illegal_affix_sequence`, `unknown_root` or `not_in_dictionary`.
- All Kitaita forms live in `data/`, exported from the research repo's speaker-verified
  tables by [`scripts/export_research_data.py`](scripts/export_research_data.py). Rows not
  confirmed by a speaker carry `unverified: true`.

Coverage and open questions are logged in [`status.md`](status.md).

## Development

```bash
pip install pyyaml pytest && pytest -q        # oracle, tiles, data hygiene
npm test                                      # grading, API client, views, scoring (no dependencies)
scripts/build_site.sh && python3 -m http.server -d _site 8000   # preview at http://localhost:8000
node tests/e2e/page.e2e.mjs                   # full page in headless Chromium (needs playwright)
GAME_API=http://127.0.0.1:7860 node tests/e2e/game.e2e.mjs   # two players against a locally running Space
```

Offline data scripts (not run in CI):

```bash
python scripts/export_research_data.py /path/to/BantuGrammar --date YYYY-MM-DD   # data/*.yaml
python scripts/corpus_stats.py /path/to/verses.jsonl --date YYYY-MM-DD          # letter counts only
python scripts/build_tiles.py                                                    # data/kitaita_tiles.json
python scripts/oracle_coverage.py /path/to/verses.jsonl                          # coverage report
```

The Bible corpus used for letter frequencies is a published translation: only
aggregate letter counts are committed, never the text.

## Deploying

`.github/workflows/pages.yml` runs all tests (a failing test blocks the
deploy) and publishes `_site/` to GitHub Pages on every push to `main`.
One-time setup: repository **Settings → Pages → Source: GitHub Actions**.
The Space API URL is the one constant in [`site/js/config.js`](site/js/config.js).
