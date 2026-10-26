# CLAUDE.md — bantugrammar-app (Africa's Talking Open Hackathon, 29 Oct 2026)

Standalone app repo (`mpily/bantugrammar-app`), separate from the research
repo `github.com/mpily/BantuGrammar`. Use this repo: `https://github.com/mpily/bantugrammar-app`

**Split of responsibilities**

| Research repo (owns the HF Space) | This repo (static, no server) |
|---|---|
| `/api/translate`, `/api/feedback`, `/api/progress` | Kitaita Scrabble: marker-oracle + tile scoring |
| `/api/verified_pairs` feed | Learner drills (Duolingo-style) |
| Africa's Talking SMS/USSD webhooks | The static web page for all features |

- This repo **never runs a server and never deploys to the Space.** It
  publishes a static site (GitHub Pages from this repo; a static HF Space is
  the alternative). All compute here runs in the browser.
- It **consumes** the Space API. The contract is `api/CONTRACT.md` in the
  research repo; copy the current version into `docs/space_api.md` here and
  code against it. If the app needs a new or changed endpoint, stop and tell
  the user — it is built in the research repo, not faked here.
- Never copy pipeline code into this repo.
- Keep `status.md` here as the product log (deploys, tile-set versions,
  oracle coverage, open questions for speakers).

---

## 1. Goal

Three things on one static page:

1. **Translator UI** — a thin client over the Space: submit Swahili, show the
   Kitaita with its status label and slot explanations, collect a star rating
   and the speaker's corrected Kitaita, show the Progress numbers.
2. **Kitaita Scrabble** — validates words with the marker-oracle (verbs and
   adjectives by morpheme-slot rules, nouns by dictionary lookup) and scores
   them with tiles derived from letter-frequency statistics. Subject, object
   and TAM markers combine productively with ANY verb root — validity comes
   from the slot rules, never from a list of attested forms.
3. **Learner drills** — verified Swahili↔Kitaita word/sentence pairs, one
   side hidden; the learner types the other; the page grades it.

Deadline: demo on 29 Oct 2026. Ship thin and working over broad and broken.

## 2. Non-negotiable rules

- **Never present unverified Kitaita as correct.** Translator output shows
  "machine translation — awaiting native-speaker review". Drills use only
  pairs from `/api/verified_pairs` (status `verified`) plus the verified
  vocabulary list in `data/`.
- **Concord/affix tables are data, not code.** Load them from
  `data/*.yaml|json`. Never hard-code a Kitaita form. Rows not confirmed by a
  speaker carry `unverified: true`, and the UI marks any parse that relies on
  one.
- **Don't invent Kitaita.** Unknown form, prefix or root → `unknown`, never a
  guess dressed up as an answer.
- **Report n.** Any statistic (letter frequencies, progress numbers, oracle
  coverage) is shown with its sample size.
- No secrets in this repo — it's public static code. The Space API it calls
  is public; nothing here needs a key.
- Don't store learner data anywhere but the learner's own browser
  (localStorage, wrapped in try/catch).
- One change per commit; run the tests before every push.
- Free tiers only. If something needs payment, stop and ask.

## 3. Architecture

```
GitHub Pages (static)                         HF Space (research repo)
┌───────────────────────────────┐            ┌──────────────────────┐
│ index.html                    │  fetch     │ /api/translate       │
│  Translator tab ──────────────┼──────────▶ │ /api/feedback        │
│  Progress tab   ──────────────┼──────────▶ │ /api/progress        │
│  Drills tab     ──────────────┼──────────▶ │ /api/verified_pairs  │
│  Scrabble tab                 │            └──────────────────────┘
│   └─ kitaita_oracle (Python,  │
│      runs in-browser via      │
│      Pyodide, lazy-loaded)    │
│   └─ data/*.yaml|json tiles   │
└───────────────────────────────┘
```

- **Oracle runs in the browser via Pyodide**, loaded only when the Scrabble
  tab opens. One Python implementation serves the page, the tests, and the
  research repo (which can `pip install` it from this repo as its fallback
  segmenter, Stage E). Measure Pyodide load time on a phone over mobile data
  and log it; if it's unacceptable for the demo, tell the user before porting
  anything.
- Package the oracle as `kitaita_oracle/` with a `pyproject.toml`, pure
  Python, standard library + PyYAML only (Pyodide-compatible), no network.
- Space API base URL in one config constant. Handle the Space being asleep:
  show "waking up the translator…" and retry with backoff — the first request
  after a 48 h idle can take a minute.
- Drills cache the last fetched verified pairs in localStorage so the tab
  still works if the Space is asleep or offline.

## 4. Features

### 4.1 Translator UI (priority 1)

Calls the Space's `/api/translate`, `/api/feedback`, `/api/progress` exactly
as documented in `docs/space_api.md`. Shows: Kitaita output with its status
badge, the `slots` explanations (which noun controls each prefix), a 1–5 star
control, a text box for the speaker's corrected Kitaita. Progress tab: counts,
mean stars with n and CI, histogram, low-n flags as the API returns them.
No logic beyond display — the statistics are computed by the Space.

### 4.2 Marker-oracle + Scrabble (priority 2)

Given a word, return whether it is a valid Kitaita word and every valid
analysis. Three word types, all returned if several match:

1. **Noun** — direct lookup in `data/kitaita_nouns.yaml` (singular + plural
   forms, class, Swahili gloss). No generation: valid only if listed.
2. **Verb** — morphological parse (below).
3. **Adjective** — adjectival concord prefix (from the concord-series table)
   + stem in `data/kitaita_adjectives.yaml`. Any class's prefix with any stem
   is valid (productive agreement), subject to the table's flags.

API of the library (and the JSON the page shows):
```python
from kitaita_oracle import analyse
analyse("naweikunda", lang="dav")
# {"word": "naweikunda", "valid": True,
#  "parses": [{"word_type": "verb",
#              "slots": [{"slot":"SM","form":"...","gloss":"1sg"},
#                        {"slot":"TAM","form":"...","gloss":"PRES"},
#                        {"slot":"OM","form":"...","gloss":"cl9"},
#                        {"slot":"ROOT","form":"kund","gloss":"love"},
#                        {"slot":"FV","form":"a"}],
#              "swahili_equivalent": "ninaipenda",
#              "uses_unverified_rules": True}],
#  "reason": None}
```

Verb design:
- Template, Bantu verb order: `(NEG) SM (NEG2) TAM (REL) (OM) ROOT (EXT*) FV`.
  Slot inventories and co-occurrence constraints (which TAMs allow REL,
  negative-specific FVs, …) in `data/kitaita_verb_slots.yaml`, with a parallel
  `data/swahili_verb_slots.yaml` so the same engine parses `ninaipenda`.
- **Productivity is the core rule**: any SM × TAM × OM combination licensed by
  the slot table attaches to any root in `data/kitaita_roots.yaml`. Never
  validate against attested inflected forms. Test it: take a root seen only
  in the infinitive and check every rule-licensed combination validates.
- Morphophonological rules (vowel coalescence, glide formation at SM+TAM and
  OM+root boundaries, nasal assimilation) in `data/kitaita_phonology.yaml`,
  applied in a fixed order so fused surface prefixes still parse; each rule
  `unverified: true` until a speaker confirms it.
- Unknown root → `valid: false, reason: "unknown_root"`, distinct from
  `"illegal_affix_sequence"` and `"not_in_dictionary"` (nouns). Scrabble needs
  to know which.
- Enumerate all segmentations; ambiguity is expected.
- **The `naweikunda` segmentation above is a placeholder.** Real Kitaita
  SM/TAM/OM forms come from Prof. Mbogho's data or a speaker. Write the
  `naweikunda ↔ ninaipenda` test only once they're confirmed.

Tile scoring:
- **Tile inventory first.** Kitaita orthography has multi-letter graphemes
  (e.g. `ch`, `ny`, `sh`, `ng'`). Which are single tiles is a decision for the
  user/speakers: grapheme list in `data/kitaita_graphemes.yaml`; words are
  tokenized into graphemes (longest match) before counting or scoring. Ask
  before finalizing it.
- **Frequencies** from Kitaita text only, preferring verified/speaker text.
  Count over word types AND tokens; report both with corpus size n. Default to
  type counts for scoring (tokens over-weight a few function words); note the
  choice in `status.md`.
- **Score**: rarer → higher. Default
  `score = clip(round(k · log(f_max / f)), 1, 10)`, k set so the rarest common
  grapheme lands near 10; blank = 0. Bag counts proportional to frequency
  (100 tiles, min 1 per grapheme). Graphemes with count < 20 are flagged
  `low_n`, not silently scored 10.
- `scripts/build_tiles.py` (run locally, offline) →
  `data/kitaita_tiles.json`, committed with corpus name, n and date. The page
  only reads the JSON.
- Scoring = oracle validation, then grapheme split × tile scores × board
  multipliers. Invalid words score 0 and show the oracle's `reason`.

### 4.3 Learner drills (priority 3)

- Source: `/api/verified_pairs` + `data/verified_vocab.yaml`. Nothing else.
- Levels: L1 nouns, L2 noun+adjective (concord), L3 SV sentences, L4 SVO with
  object marker. Use each pair's `noun_class` so a lesson can drill one concord
  series at a time.
- Directions: swh→dav, dav→swh, mixed. Show one side, learner types the other.
- Grading client-side: normalize case, whitespace, punctuation and apostrophe
  variants (’ vs ', as in `Kidaw'ida`); exact match against expected +
  accepted alternatives; edit distance 1 → "almost", showing the expected form.
- Answers are in the browser, so a determined learner can peek — acceptable
  for a practice tool; don't add server-side grading for this.
- Progress (streaks, items seen) in localStorage only.

## 5. Repo layout

```
bantugrammar-app/
  CLAUDE.md
  status.md
  docs/space_api.md        copy of the Space contract
  kitaita_oracle/          pure-Python library (pyproject.toml)
  scripts/build_tiles.py   letter frequency → tile scores
  data/                    nouns, roots, adjectives, slots, phonology,
                           graphemes, tiles.json, verified_vocab
  site/                    static page (index.html, js, css)
  tests/
  .github/workflows/pages.yml   test + deploy to GitHub Pages
```

## 6. Testing & verification

- `pytest` for the oracle: hand-checked positive AND negative words (illegal
  affix order, unknown root, wrong-class OM, non-adjectival prefix, noun not
  in dictionary), the productivity test, grapheme tokenizer, tiles
  reproducible from the committed corpus stats.
- A test that the same oracle runs under Pyodide (headless browser, or at
  least import-check with only Pyodide-available packages).
- JS tests for drill normalization/grading and the translator client against
  a mocked API response matching `docs/space_api.md`.
- CI runs tests before the Pages deploy; a failing test blocks deploy.
- Before claiming a feature works, open the deployed page and use it
  against the live Space.
- Log in `status.md`: oracle coverage on the dictionary's verbs, Pyodide
  load time on mobile, tile-set version.

## 7. Demo narrative (for README / pitch)

"Machine translation for a language with almost no data, made honest by
native speakers": translate a sentence and show why each prefix changed → a
speaker rates and corrects it by SMS → the Progress tab updates → the
corrected sentence is promoted to verified → it appears in a learner drill →
the oracle validates and scores a Scrabble word built from the same
morphology.

## 8. Decisions taken (log; newest last)

- **2026-10-26, tile inventory (user decision):** tiles are **single
  letters**. Digraphs are split: `gh` = g + h, `ny` = n + y, `ng'` = n + g.
  The apostrophe is ignored for now. Recorded in
  `data/kitaita_graphemes.yaml`.
- **2026-10-26, frequency corpus (user decision):** letter frequencies come
  from the Kitaita Bible corpus the user supplied (`verses.jsonl`, abbr
  `TAITA`, 31,103 verses). The text is a published Bible translation, so
  only aggregate counts (`data/kitaita_corpus_stats.json`) are committed,
  never the verses. `scripts/corpus_stats.py` regenerates them from a
  local copy.
- **Data provenance:** `data/` tables are exported from the research repo's
  speaker-verified tables (`kitaita_verified_corrections.py`, Word Bank
  submissions) and its corpus-alignment output (`page1_vocabulary.json`) by
  `scripts/export_research_data.py`. Corpus-aligned items carry
  `unverified: true`. No research code is copied here.
- **Browser-read data is JSON** (`kitaita_tiles.json`, `verified_vocab.json`):
  the page has no YAML parser. Python-read tables are YAML.
