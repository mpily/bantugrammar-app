import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReview, classLabel, classOptions, filterQueue, reviewSummary } from "../../site/js/review_logic.js";

test("review body: translation, type and class", () => {
  assert.deepEqual(buildReview("kifumbi", true, { translation: " kiti ", wordType: "noun", nounClass: "chi" }).body,
    { word: "kifumbi", approve: true, translation: "kiti", word_type: "noun", noun_class: "chi" });
  assert.deepEqual(buildReview("zawa", false).body, { word: "zawa", approve: false });
  assert.match(buildReview("x", true, { wordType: "verb", nounClass: "chi" }).error, /only be set for nouns/);
  assert.match(buildReview("x", true, { wordType: "pronoun" }).error, /unknown word type/);
});

test("class picker labels use the app's class table, server ids win", () => {
  const app = [{ id: "chi", nearest_swahili_class: "7", number: "sg", examples: ["kikombe", "chuo", "kifumbi", "x"] },
               { id: "gh", nearest_swahili_class: null, number: "unknown", examples: [] }];
  assert.equal(classLabel(app[0]), "chi (Sw. cl. 7, sg) — e.g. kikombe, chuo, kifumbi");
  assert.equal(classLabel(app[1]), "gh (no Swahili match)");
  assert.deepEqual(classOptions(["u", "chi"], app).map((o) => o.id), ["chi", "u"]);
  assert.equal(classOptions(["u"], app)[0].label, "u");
  assert.deepEqual(classOptions([], app).map((o) => o.id), ["chi", "gh"]);
});

test("queue filters and summaries", () => {
  const q = [{ word: "a", review: null }, { word: "b", review: { approved: true } }, { word: "c", review: { approved: false } }];
  assert.deepEqual(filterQueue(q, "todo").map((w) => w.word), ["a"]);
  assert.deepEqual(filterQueue(q, "approved").map((w) => w.word), ["b"]);
  assert.deepEqual(filterQueue(q, "declined").map((w) => w.word), ["c"]);
  assert.equal(filterQueue(q, "all").length, 3);
  assert.equal(reviewSummary(null), "not reviewed yet");
  assert.equal(reviewSummary({ approved: true, word_type: "noun", noun_class: "chi", translation: "kiti", reviewed_at: "2026-10-28T09:00:00Z" }),
    "approved · noun, class chi · “kiti” (2026-10-28)");
});

test("api client sends the reviewer key header", async () => {
  const { makeClient } = await import("../../site/js/api.js");
  let seen;
  const api = makeClient({ base: "", fetchImpl: async (url, opts) => {
    seen = { url, opts };
    return { status: 200, ok: true, headers: { get: () => "application/json" }, json: async () => ({ api_version: "1", words: [] }) };
  } });
  await api.review("k3y", { word: "x", approve: true });
  assert.equal(seen.url, "/api/player_words/review");
  assert.equal(seen.opts.headers["X-Reviewer-Key"], "k3y");
  assert.equal(seen.opts.headers["Content-Type"], "application/json");
  await api.reviewQueue("k3y");
  assert.equal(seen.opts.headers["X-Reviewer-Key"], "k3y");
});
