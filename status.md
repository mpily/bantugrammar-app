# status.md — product log (newest entries last)

## 2026-10-26: first build of the app (oracle, tiles, translator UI, drills, Scrabble)

**Built:** `kitaita_oracle/` (pure Python + PyYAML), `data/` tables exported from
the research repo (`mpily/BantuGrammar@8acde46`, same data as `main@c93d74d`),
tiles from the Bible corpus, and the static page (`site/`) with Translate,
Progress, Drills and Scrabble tabs. CI workflow: tests, then Pages deploy.

**Not done yet / not verified:**
- **Not deployed.** GitHub Pages must be switched on (Settings → Pages → Source:
  GitHub Actions) and the branch merged to `main`.
- **Not tested against the live Space**: this build machine cannot reach
  `*.hf.space` (network policy). The translator, feedback, progress and
  verified-pairs calls were tested against mocked responses copied from
  `docs/space_api.md` (Node unit tests + a headless-Chromium end-to-end run).
  CLAUDE.md requires opening the deployed page against the live Space before
  calling it working, so that still needs doing after deploy.

### Decisions (user, 2026-10-26)
- Tiles are single letters; digraphs split (gh = g + h, ny = n + y, ng' = n + g);
  apostrophe ignored. Inventory version `letters-2026-10-26`.
- Letter frequencies from the user's Kitaita Bible corpus (`verses.jsonl`,
  abbr TAITA, version_id 2138, 31,103 verses, sha256 in
  `data/kitaita_corpus_stats.json`). Only aggregate counts are committed.

### Tile set `letters-2026-10-26+type-counts`
- Corpus after cleaning: 577,495 word tokens, 45,016 word types; 439,149
  letters counted over types.
- **Scoring uses type counts** (CLAUDE.md default; token counts over-weight
  function words like *na*). Token-based scores differ by at most 2 points per
  letter (e.g. n: 3 by types, 2 by tokens; c: 5 vs 7).
- k = 2.4934 so the rarest common letter (p, count 1,268) scores 10; a = 1.
- q and x never occur in the corpus: kept in the inventory, no tiles. No
  occurring letter has count < 20, so nothing is flagged low_n.
- Bag: 100 letter tiles (largest remainder, min 1) + 2 blanks.

### Oracle coverage (scripts/oracle_coverage.py, seed 0)
| Set | n | accepted | 95% CI (Wilson) |
|---|---|---|---|
| Hand-checked speaker-verified verb forms (tests) | 15 | 15 | — (test cases) |
| Verified vocabulary words (`verified_vocab.json`) | 91 | 98.9% | 94.0–99.8% |
| Bible corpus word types (≥3 letters), random sample | 2,000 | 17.9% | 16.3–19.6% |
| Control: same sample, letters shuffled | 2,000 | 0.1% | 0.0–0.3% |
| Bible running text (all 577,495 tokens) | 577,495 | 43.6% | — |

- Corpus-root cutoff (alignment score of corpus-derived roots): 0.3 → 13.3%,
  **0.2 → 17.8% (used)**, 0.1 → 20.9% of corpus types (measured before closed-class words were added); the shuffled control
  stayed at 0.1% at every cutoff. 0.2 chosen as the smaller file for the
  browser. All corpus roots are `unverified: true`.
- Closed-class words (verified demonstratives, possessives, "of" particles,
  function words) add 15.4 points of running-text coverage.
- **Why most corpus words are still rejected** (sampled): no data yet for
  verb extensions and the -agha ending (*nisikiragha*, *rakundika*,
  *yadakabwa*), other tense markers (*uchaashoma*, *uridaike*), class/3sg
  object markers (*kumjisha*), the "of" particle for most classes (*wa, ya,
  ghwa, cha, ja, ra*), roots below the cutoff (*kukaia*), proper names. None
  of these are filled in by guessing; they need speaker data.

### Pyodide load time (Scrabble tab)
- Headless Chromium, desktop: 2.2–3.2 s (files served locally).
- Emulated phone (4x CPU slowdown): 13.1 s. **This excludes download time**
  (Playwright's network throttling does not apply to the locally served files).
- Download: ≈ 5.9 MB compressed (Pyodide wasm 3.2 MB + stdlib 2.3 MB + JS 0.2 MB
  + PyYAML 0.1 MB + oracle data ~0.1 MB). Estimated ~30 s on a 1.6 Mbit/s
  (3G-class) link, ~5 s on 10 Mbit/s 4G, on top of the CPU time.
- **Not yet measured on a real phone over mobile data.** If 15–45 s is
  unacceptable for the demo, decide before porting anything (options:
  pre-load the tab during the translator demo; ship a JSON copy of the data).

### Open questions for speakers
1. Should ch / gh / ny / sh / ng' be single tiles?
2. Past-tense subject-marker lowering (u→o, i→e: *orekoghe* vs *urekoghe*): is it
   optional everywhere, or tied to particular verbs/classes?
3. Linking -u- after a bare consonant marker (2pl *m*-) — general?
4. Object markers: confirm 1sg *ni*, 1pl *di*, cl2/2pl *wi*; give 2sg and the class
   object markers (e.g. cl9 for the *naweikunda* example).
5. Relative markers and verb extensions (-ik-, -ish-, -w-, -an-, -agha).
6. "of" particle for every class (only *gha* (cl.ghi) and *lwa* (cl.lu) are verified).
7. Negative class *va*: *vi* (as submitted) or *va*?

### Needs a Space API change (not faked here)
- Drill levels L2–L4 (noun+adjective / SV / SVO with object marker) need a
  sentence-structure tag on `/api/verified_pairs`. The API's `level` is only a
  length heuristic, so the page groups sentences together for now.

## 2026-10-26 (cont.): verb detection — "gala"/"legha" were rejected; coverage 18.9% → 55.2%

User report: the verbs *gala* and *legha* were refused. Causes: (1) the root
*legh* was missing (the research alignment never extracted it, though the corpus
has *kulegha* 50×, *ukalegha* 44×, *wikalegha* 30×); (2) bare forms (root + -a)
had no paradigm; (3) *gala* has no inflected form anywhere in the corpus.

**Method.** One change at a time, each measured on the HELD-OUT half of corpus
word types (`split_half` in `scripts/oracle_coverage.py`; roots are induced
from the other half only), n = 3,000 sampled types, with controls: the same
words with letters shuffled, and (from E5) one-letter mutants that are not
corpus words.

| Step | Change (all new items `unverified: true`) | Held-out accepted | 95% CI | Shuffled control |
|---|---|---|---|---|
| E0 | baseline | 18.9% | 17.6–20.4 | 0.1% |
| E1 | bare imperative/citation form (root + -a), reported by the project owner | 19.9% | 18.5–21.3 | 0.1% |
| E3a | corpus suffixes after verified roots: passive -w-/-lw-, stative -ek-/-ik-, applicative -i-/-ir-/-er-/-el-/-il-, causative -ish-/-is-, reciprocal -an-; endings -agha, -ie, -ieghe, -eghe, -o, -e | 30.4% | 28.8–32.1 | 0.1% |
| E4a | corpus object markers m-, i-, ku-, ri-, ghi-, ji-, chi-, ghu- | 33.7% | 32.1–35.4 | 0.1% |
| E4b | future -chaa-; na-/kwa- and fused SMs before perfect -da-; class negative subjunctive -se-; ending -oghe | 35.9% | 34.2–37.6 | 0.1% |
| E5 | roots induced from the corpus (`scripts/induce_roots.py`) | **55.2%** | 53.4–57.0 | 0.2% (0.1–0.4) |

- E5 harder control: one-letter mutants not in the corpus are accepted 4.3%
  (3.6–5.1%), vs 55% for real held-out words. Some mutants may be real words
  the Bible lacks, so this is an upper bound on false accepts.
- Running text (all 577,495 tokens, roots induced from the train half): 56.6%.
- Speaker-verified vocabulary words: 91/91.
- **Root induction:** a candidate root is kept only if it follows ≥3 different
  licensed prefixes, ≥2 of them "strong" (tense marker, infinitive ku- or
  negation). Candidates are dropped when they are affix fragments (*egh*),
  a known root plus ≤3 letters or plus object marker/extensions (*mzer* = m + *zer*,
  *kaiagh* = *kai* + *-agh-*), or a known root minus a leading marker with less
  evidence (*any* vs *many*). The shipped file uses the whole corpus: 526 roots,
  no glosses (the corpus shows a string behaves like a root, not what it means).
- **Reported roots:** `data/kitaita_roots_reported.yaml` holds roots the project
  owner reports but the corpus does not attest: `gal` (*gala*). Meaning not
  recorded yet.
- **Analysis order:** speaker-verified root first, then fewest unverified
  assumptions, then shorter root (more morphemes recognized). Known wrong
  order: *wikamlegha* lists the research corpus root *mlegh* before m + *legh*.
- Oracle load in headless desktop Chromium: 4.6 s (was 2.2–3.2 s), because of
  the larger root list and the extra paradigms.

**Open questions for speakers (added):** what does *gala* mean, and how is it
inflected? Are the suffix functions guessed above right (-agha habitual,
-ieghe/-eghe/-oghe past perfective, -w- passive, -ir-/-er- applicative,
-ish- causative, -an- reciprocal)? Is *-chaa-* a separate future? Do class
subjects take negative subjunctive *-se-*?
