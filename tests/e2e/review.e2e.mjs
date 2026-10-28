// Reviewer page in headless Chromium against a REAL local Space API that has the
// reviewer key "rev-test" and two seeded votes (kifumbii accepted, zawa voted down):
//   REVIEW_API=http://127.0.0.1:7871 node tests/e2e/review.e2e.mjs
// Run scripts/build_site.sh first. Skips (exit 0) when REVIEW_API is not set.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const API = process.env.REVIEW_API;
if (!API) { console.log("REVIEW_API not set: skipping review e2e"); process.exit(0); }
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SITE = new URL("../../_site/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "");
  if (path === "" || path.endsWith("/")) path += "index.html";
  try { const b = await readFile(join(SITE, path)); res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}review.html?api=${encodeURIComponent(API)}`);

// wrong key
await page.fill("#rv-key", "nope");
await page.click("#rv-key-form button[type=submit]");
await page.waitForFunction(() => /not accepted/.test(document.querySelector("#rv-status").textContent));
console.log("ok wrong key rejected");

await page.fill("#rv-key", "rev-test");
await page.click("#rv-key-form button[type=submit]");
await page.waitForSelector(".review-card");
const words = await page.$$eval(".review-card", (cs) => cs.map((c) => c.dataset.word).sort());
assert.deepEqual(words, ["kifumbii", "zawa"]);
assert.match(await page.textContent('.review-card[data-word="zawa"]'), /voted down by players/);
console.log("ok queue shows accepted and voted-down words");

// approve kifumbii as a noun of class chi with a translation
const kif = '.review-card[data-word="kifumbii"]';
await page.fill(`${kif} input[name=translation]`, "kiti");
assert.equal(await page.isVisible(`${kif} .noun-class`), false);
await page.selectOption(`${kif} select[name=word_type]`, "noun");
assert.equal(await page.isVisible(`${kif} .noun-class`), true);
const label = await page.$eval(`${kif} select[name=noun_class] option[value=chi]`, (o) => o.textContent);
assert.match(label, /chi \(Sw\. cl\. 7, sg\)/);
await page.selectOption(`${kif} select[name=noun_class]`, "chi");
await page.click(`${kif} button[value=approve]`);
// approved -> leaves the "needs review" list
await page.waitForFunction(() => !document.querySelector('.review-card[data-word="kifumbii"]'));
// decline zawa
await page.click('.review-card[data-word="zawa"] button[value=decline]');
await page.waitForFunction(() => document.querySelectorAll(".review-card").length === 0);
await page.selectOption("#rv-filter", "all");
await page.waitForSelector(".review-card");
assert.match(await page.textContent(kif), /approved · noun, class chi · “kiti”/);
assert.match(await page.textContent('.review-card[data-word="zawa"]'), /declined/);
console.log("ok approve with translation + class, decline");

// public feed reflects it
const feed = await (await fetch(`${API}/api/player_words`)).json();
assert.deepEqual(feed.words.map((w) => [w.word, w.status, w.translation, w.word_type, w.noun_class]),
  [["kifumbii", "verified", "kiti", "noun", "chi"]]);
console.log("ok public feed: kifumbii verified (kiti, noun, chi); zawa not listed");
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "review.png"), fullPage: true });
assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log("REVIEW E2E OK");
