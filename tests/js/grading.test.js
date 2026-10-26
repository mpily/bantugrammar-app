import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, grade, normalize } from "../../site/js/grading.js";

test("normalize: case, whitespace, punctuation, apostrophe variants", () => {
  assert.equal(normalize("  Kidaw’ida,  NI   lugha!  "), "kidaw'ida ni lugha");
  assert.equal(normalize("Kidaw'ida"), normalize("kidaw’ida"));
  assert.equal(normalize("“Mundu”."), "mundu");
});

test("exact match and accepted alternatives", () => {
  assert.equal(grade("Mundu", "mundu").result, "correct");
  assert.equal(grade("kiteto", "lumi", ["kiteto"]).result, "correct");
});

test("edit distance 1 is 'almost' and shows the expected form", () => {
  const g = grade("mundo", "mundu");
  assert.equal(g.result, "almost");
  assert.equal(g.expected, "mundu");
  assert.equal(grade("mund", "mundu").result, "almost");
  assert.equal(grade("mndo", "mundu").result, "wrong");
});

test("empty answers are not graded", () => {
  assert.equal(grade("   ", "mundu").result, "empty");
});

test("editDistance", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
});
