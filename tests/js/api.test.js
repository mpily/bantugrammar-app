// Translator client against mocked responses shaped like docs/space_api.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClient, ApiError } from "../../site/js/api.js";

const TRANSLATE = {
  api_version: "1", id: "tr_01K", source: "Nyoka aja", swahili_mt: "Nyoka aja",
  kitaita: "Choka aja.", kitaita_marked: "Choka [?aja].", status: "machine",
  label: "machine translation — awaiting native-speaker review",
  unknown_words: ["aja"], vocabulary_gaps: 1,
  slots: [{ slot: "aja", controller: "Nyoka", relation: "nsubj", rewritten_to: "ya", verified_form: false,
            slot_type: "subject_sm", confidence: "statistical", token_index: 1, sentence_index: 0 }],
  flags: [], mode: "probes", verified_alternative: null, pipeline_version: "git-abc", latency_ms: 1830, cached: false,
};

function res(status, body, ct = "application/json") {
  return { status, ok: status < 300, headers: { get: () => ct }, json: async () => body };
}

test("translate posts the contract request and returns the response", async () => {
  const calls = [];
  const api = makeClient({ base: "https://x", fetchImpl: async (url, opts) => { calls.push([url, opts]); return res(200, TRANSLATE); } });
  const r = await api.translate("Nyoka aja");
  assert.equal(r.id, "tr_01K");
  assert.equal(calls[0][0], "https://x/api/translate");
  assert.deepEqual(JSON.parse(calls[0][1].body), { text: "Nyoka aja", src: "swh", tgt: "dav" });
});

test("sleeping Space: retries with backoff and reports waking", async () => {
  const seq = [null, res(503, null, "text/html"), res(200, TRANSLATE)];
  const waking = [], slept = [];
  const api = makeClient({
    base: "", delays: [1, 2, 3], sleep: async (ms) => slept.push(ms),
    onWaking: (n) => waking.push(n),
    fetchImpl: async () => { const r = seq.shift(); if (r === null) throw new TypeError("network"); return r; },
  });
  const r = await api.translate("x");
  assert.equal(r.status, "machine");
  assert.deepEqual(waking, [1, 2]);
  assert.deepEqual(slept, [1, 2]);
});

test("gives up after the retry budget", async () => {
  const api = makeClient({ base: "", delays: [1], sleep: async () => {}, fetchImpl: async () => { throw new TypeError("down"); } });
  await assert.rejects(api.progress(), (e) => e instanceof ApiError && e.status === 0);
});

test("API errors surface the contract error body (no retry on 4xx)", async () => {
  let n = 0;
  const api = makeClient({ base: "", delays: [1, 1], sleep: async () => {}, fetchImpl: async () => { n++; return res(404, { api_version: "1", error: "translation_id 'x' not found" }); } });
  await assert.rejects(api.feedback({ translation_id: "x", stars: 3, speaker_id: "s" }), /not found/);
  assert.equal(n, 1);
});

test("rejects an unexpected api_version", async () => {
  const api = makeClient({ base: "", fetchImpl: async () => res(200, { ...TRANSLATE, api_version: "2" }) });
  await assert.rejects(api.translate("x"), /api_version/);
});

test("verified_pairs query string", async () => {
  let url;
  const api = makeClient({ base: "", fetchImpl: async (u) => { url = u; return res(200, { api_version: "1", pairs: [] }); } });
  await api.verifiedPairs({ kind: "word", since: "2026-10-01T00:00:00Z" });
  assert.equal(url, "/api/verified_pairs?since=2026-10-01T00%3A00%3A00Z&kind=word");
});

export { TRANSLATE };
