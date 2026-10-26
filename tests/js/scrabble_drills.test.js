import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { drawRack, letters, makeBag, rackUse, scoreWord } from "../../site/js/scoring.js";
import { buildItems, filterItems, promptFor } from "../../site/js/drill_logic.js";
import { ORACLE_DATA_FILES, ORACLE_PY_FILES } from "../../site/js/config.js";

const tiles = JSON.parse(readFileSync(new URL("../../data/kitaita_tiles.json", import.meta.url)));
const VALID = { valid: true, parses: [{ word_type: "noun" }], reason: null };

test("letters: single-letter tiles, apostrophes ignored", () => {
  assert.deepEqual(letters("Ng’ombe"), ["n", "g", "o", "m", "b", "e"]);
});

test("invalid words score 0 and carry the oracle reason", () => {
  const s = scoreWord("xyz", { valid: false, parses: [], reason: "unknown_root" }, tiles);
  assert.equal(s.score, 0);
  assert.equal(s.reason, "unknown_root");
});

test("score = sum(tile x letter premium) x word premium", () => {
  const score = (l) => tiles.tiles.find((t) => t.grapheme === l).score;
  // start at square 1 (TW): m(TW) u n(DL at index 3) d u
  const s = scoreWord("mundu", VALID, tiles, { start: 0 });
  const expected = (score("m") + score("u") + score("n") + 2 * score("d") + score("u")) * 3;
  assert.equal(s.score, expected);
  // blanks score 0
  const b = scoreWord("mundu", VALID, tiles, { start: 4, blanks: [0] });
  assert.equal(b.breakdown[0].points, 0);
});

test("words that don't fit the row are flagged", () => {
  assert.equal(scoreWord("mundu", VALID, tiles, { start: 13 }).reason, "does_not_fit_row");
});

test("bag has 100 letter tiles + blanks; racks draw 7", () => {
  const bag = makeBag(tiles);
  assert.equal(bag.filter((x) => x !== "?").length, 100);
  assert.equal(bag.filter((x) => x === "?").length, tiles.blank.bag);
  assert.equal(drawRack(bag).length, 7);
});

test("rackUse covers missing letters with blanks", () => {
  assert.deepEqual(rackUse("mundu", ["m", "u", "n", "d", "?"]), { fromRack: true, missing: [], blanks: [4] });
  assert.equal(rackUse("mundu", ["m"]).fromRack, false);
});

test("drill items: verified API pairs + vocab, deduplicated, filterable", () => {
  const api = [{ id: "vp_1", swahili: "Nyoka", kitaita: "Choka", kind: "word", noun_class: "i_nasal", level: 1, verified_at: "x", status: "verified" },
               { id: "vp_2", swahili: "Nyoka aja", kitaita: "Choka icha", kind: "sentence", noun_class: null, level: 2, verified_at: "x", status: "verified" },
               { id: "vp_3", swahili: "x", kitaita: "y", kind: "word", status: "machine" }];
  const vocab = [{ id: "vv_1", swahili: "nyoka", kitaita: "choka", kind: "word", noun_class: "i_nasal", accepted_alternatives: [] },
                 { id: "vv_2", swahili: "mtoto", kitaita: "mwana", kind: "word", noun_class: "u", accepted_alternatives: [] }];
  const items = buildItems(api, vocab);
  assert.deepEqual(items.map((i) => i.id), ["vp_1", "vp_2", "vv_2"]); // vp_3 is not verified; vv_1 duplicates vp_1
  assert.equal(filterItems(items, { level: "words" }).length, 2);
  assert.equal(filterItems(items, { nounClass: "u" })[0].kitaita, "mwana");
  const p = promptFor(items[2], "swh-dav");
  assert.equal(p.show, "mtoto");
  assert.equal(p.expected, "mwana");
});

test("config lists every oracle file and every listed file exists", () => {
  const root = new URL("../../", import.meta.url);
  for (const f of [...ORACLE_PY_FILES, ...ORACLE_DATA_FILES]) assert.ok(existsSync(new URL(f, root)), f);
  const py = ["__init__.py", "graphemes.py", "oracle.py", "tables.py", "verbs.py"];
  assert.deepEqual([...ORACLE_PY_FILES].sort(), py.map((p) => "kitaita_oracle/" + p).sort());
  const loaded = new Set(ORACLE_DATA_FILES);
  for (const f of ["kitaita_verb_slots.yaml", "kitaita_closed_class.yaml", "swahili_verb_slots.yaml"]) assert.ok(loaded.has("data/" + f), f);
});
