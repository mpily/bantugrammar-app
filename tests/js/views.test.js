import { test } from "node:test";
import assert from "node:assert/strict";
import { histogramBars, kitaitaHtml, progressLines, slotRows, statusBadge } from "../../site/js/views.js";
import { TRANSLATE } from "./api.test.js";

const PROGRESS = {
  api_version: "1",
  counts: { translations: 120, feedback: 31, unique_speakers: 6, verified_pairs: 4 },
  mean_stars: { mean: 3.4, ci95: [2.9, 3.9], n: 28, low_n: false },
  four_plus_rate: { rate: 0.46, ci95: [0.29, 0.64], k: 13, n: 28, low_n: false },
  star_histogram: { 1: 3, 2: 5, 3: 7, 4: 8, 5: 5 },
  exact_match: { rate: 0.2, ci95: [0.07, 0.45], k: 3, n: 4, low_n: true },
  chrf: { mean: 61.2, ci95: null, n: 1, low_n: true },
  trend: [], low_n_threshold: 5, generated_at: "2026-10-29T12:00:00+00:00",
};

test("unknown words are visibly marked, never shown as Kitaita", () => {
  const html = kitaitaHtml(TRANSLATE);
  assert.match(html, /<mark class="unknown-word"[^>]*>aja\?<\/mark>/);
  assert.equal(kitaitaHtml({ kitaita: null }), '<span class="unknown">unknown</span>');
});

test("escapes HTML in API strings", () => {
  assert.doesNotMatch(kitaitaHtml({ kitaita: "<b>x</b>", kitaita_marked: "<b>x</b>" }), /<b>/);
});

test("status badges", () => {
  assert.match(statusBadge("machine"), /awaiting native-speaker review/);
  assert.match(statusBadge("verified"), /badge-verified/);
  assert.match(statusBadge("nonsense"), /badge-unknown/);
});

test("slot explanations name the controlling noun", () => {
  const [row] = slotRows(TRANSLATE.slots);
  assert.equal(row.explanation, "subject prefix agrees with “Nyoka”");
  assert.equal(row.rewritten_to, "ya");
  assert.equal(row.verified, false);
});

test("progress lines always show n and pass low-n through", () => {
  const lines = progressLines(PROGRESS);
  assert.equal(lines.length, 4);
  for (const l of lines) assert.match(l.detail, /n = \d+/);
  assert.deepEqual(lines.map((l) => l.low), [false, false, true, true]);
  assert.match(lines[3].detail, /CI n\/a/);
});

test("histogram bars scale to the max", () => {
  const bars = histogramBars(PROGRESS.star_histogram);
  assert.equal(bars.find((b) => b.stars === "4").width, 100);
  assert.equal(bars.length, 5);
});
