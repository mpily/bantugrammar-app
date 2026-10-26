// End-to-end check of the built page in headless Chromium:
//   node tests/e2e/page.e2e.mjs [--mobile]
// Serves _site/ (run scripts/build_site.sh first), mocks the Space API with
// responses shaped like docs/space_api.md, and runs the real oracle in Pyodide.
// PYODIDE_DIR=/path/to/pyodide serves Pyodide from a local copy instead of the CDN.
// --mobile: emulates a phone on a slow mobile connection and prints the oracle load time.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SITE = new URL("../../_site/", import.meta.url).pathname;
const MOBILE = process.argv.includes("--mobile");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".yaml": "text/plain", ".py": "text/plain", ".wasm": "application/wasm", ".zip": "application/zip", ".whl": "application/zip", ".mjs": "text/javascript" };

const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "");
  if (path === "" || path === "." || path.endsWith("/")) path = path.replace(/\.$/, "") + "index.html";
  try {
    const body = await readFile(join(SITE, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const TRANSLATE = {
  api_version: "1", id: "tr_E2E", source: "Nyoka aja", swahili_mt: "Nyoka aja", kitaita: "Choka aja.",
  kitaita_marked: "Choka [?aja].", status: "machine", label: "machine translation — awaiting native-speaker review",
  unknown_words: ["aja"], vocabulary_gaps: 1, flags: ["note"], mode: "probes", verified_alternative: null,
  slots: [{ slot: "aja", controller: "Nyoka", relation: "nsubj", rewritten_to: "ya", verified_form: false, slot_type: "subject_sm", confidence: "statistical", token_index: 1, sentence_index: 0 }],
  pipeline_version: "git-e2e", latency_ms: 1200, cached: false,
};
const PROGRESS = {
  api_version: "1", counts: { translations: 12, feedback: 7, unique_speakers: 3, verified_pairs: 1 },
  mean_stars: { mean: 3.5, ci95: [2.4, 4.6], n: 6, low_n: false }, four_plus_rate: { rate: 0.5, ci95: [0.19, 0.81], k: 3, n: 6, low_n: false },
  star_histogram: { 1: 0, 2: 1, 3: 2, 4: 2, 5: 1 }, exact_match: { rate: 0.5, ci95: [0.09, 0.91], k: 1, n: 2, low_n: true },
  chrf: { mean: 70, ci95: [40, 100], n: 2, low_n: true }, trend: [{ date: "2026-10-27", translations: 12, feedback: 7, rated: 6, mean_stars: 3.5, low_n: false }],
  low_n_threshold: 5, generated_at: "2026-10-27T10:00:00+00:00",
};
const PAIRS = { api_version: "1", pairs: [{ id: "vp_1", swahili: "Nyoka aja", kitaita: "Choka icha", kind: "sentence", noun_class: null, level: 2, verified_at: "2026-10-27T10:00:00+00:00", status: "verified" }] };

const browser = await chromium.launch();
const context = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let feedbackBody = null;
await page.route("**/api/**", async (route) => {
  const url = route.request().url();
  if (url.includes("/api/translate")) return route.fulfill(json(TRANSLATE));
  if (url.includes("/api/feedback")) { feedbackBody = JSON.parse(route.request().postData()); return route.fulfill(json({ api_version: "1", id: "fb_1", translation_id: "tr_E2E", translation_status: "speaker_corrected", promoted: false })); }
  if (url.includes("/api/progress")) return route.fulfill(json(PROGRESS));
  if (url.includes("/api/verified_pairs")) return route.fulfill(json(PAIRS));
  return route.fulfill(json({ api_version: "1", error: "not mocked" }, 404));
});
if (process.env.PYODIDE_DIR) {
  await page.route("https://cdn.jsdelivr.net/pyodide/**", async (route) => {
    const file = route.request().url().split("/full/")[1].split("?")[0];
    try {
      const body = await readFile(join(process.env.PYODIDE_DIR, file));
      await route.fulfill({ status: 200, body, contentType: TYPES[extname(file)] || "application/octet-stream" });
    } catch { await route.fulfill({ status: 404 }); }
  });
}
if (MOBILE) {
  const cdp = await context.newCDPSession(page);
  // "Fast 3G"-like profile + 4x CPU slowdown (a mid-range phone)
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

await page.goto(base);

// Translator
await page.fill("#tr-input", "Nyoka aja");
await page.click("#tr-form button");
await page.waitForSelector("mark.unknown-word");
assert.match(await page.textContent("#tr-result"), /awaiting native-speaker review/);
assert.match(await page.textContent("#tr-result"), /subject prefix agrees with “Nyoka”/);
await page.check("input[name=stars][value='4']");
await page.fill("#fb-native", "Choka icha");
await page.click("#fb-form button[type=submit]");
await page.waitForFunction(() => document.querySelector("#fb-status").textContent.includes("Asante"));
assert.equal(feedbackBody.translation_id, "tr_E2E");
assert.equal(feedbackBody.stars, 4);
assert.equal(feedbackBody.channel, "web");
assert.equal(feedbackBody.speaker_name, null);
console.log("ok translator + feedback");
const shot = async (name) => process.env.SCREENSHOT_DIR && page.screenshot({ path: join(process.env.SCREENSHOT_DIR, name + ".png"), fullPage: true });
await shot("translator");

// Progress
await page.click("[data-tab=progress]");
await page.waitForSelector(".cards");
const prog = await page.textContent("#progress-body");
assert.match(prog, /n = 6/);
assert.match(prog, /low n/);
console.log("ok progress");
await shot("progress");

// Drills
await page.click("[data-tab=drills]");
await page.waitForFunction(() => document.querySelector("#drill-source").textContent.includes("Total n ="));
await page.selectOption("#drill-level", "sentences");
await page.selectOption("#drill-dir", "swh-dav");
for (let i = 0; i < 30 && !/Nyoka aja/.test(await page.textContent("#drill-prompt")); i++) await page.click("#drill-next");
assert.match(await page.textContent("#drill-prompt"), /Nyoka aja/);
await page.fill("#drill-answer", "choka  icha.");
await page.click("#drill-form button[type=submit]");
assert.match(await page.textContent("#drill-feedback"), /Correct/);
console.log("ok drills");

// Scrabble (real oracle in Pyodide)
await page.click("[data-tab=scrabble]");
await page.waitForFunction(() => /ready|Could not/.test(document.querySelector("#sc-status").textContent), null, { timeout: 300000 });
const status = await page.textContent("#sc-status");
assert.match(status, /ready/, status);
const secs = await page.evaluate(() => globalThis.__oracleLoadSeconds);
async function check(word) {
  await page.fill("#sc-word", word);
  await page.click("#sc-form button");
  await page.waitForFunction((w) => document.querySelector("#sc-result").dataset.word === w, word);
  return page.textContent("#sc-result");
}
assert.match(await check("wawemanya"), /Valid — \d+ points/);
await page.click("#scrabble details summary");
await shot("scrabble_valid");
assert.match(await check("ndeukunde"), /Valid/);
assert.match(await check("kizamie"), /illegal_affix_sequence/);
assert.match(await check("wawekpakpa"), /unknown_root/);
console.log(`ok scrabble (oracle load ${secs} s${MOBILE ? ", mobile emulation: Fast-3G-like network + 4x CPU slowdown" : ""})`);

assert.deepEqual(errors, []);
await page.screenshot({ path: process.env.SCREENSHOT || "/tmp/e2e.png", fullPage: true });
await browser.close();
server.close();
console.log("E2E OK");
