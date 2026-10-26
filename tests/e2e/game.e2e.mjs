// Two players in headless Chromium against a REAL game server (the Space API run locally):
//   GAME_API=http://127.0.0.1:7870 node tests/e2e/game.e2e.mjs
// Run scripts/build_site.sh first. Skips (exit 0) when GAME_API is not set.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const API = process.env.GAME_API;
if (!API) { console.log("GAME_API not set: skipping game e2e"); process.exit(0); }
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
const errors = [];
const mk = async (mobile) => {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  return p;
};
const a = await mk(false), b = await mk(true);

await a.goto(`${base}game.html?api=${encodeURIComponent(API)}`);
await a.click("#g-create");
await a.waitForURL(/room=[A-Z]{5}/);
const roomUrl = a.url();
await a.fill("#g-name", "Amina");
await a.click("#g-join-form button");
await a.waitForSelector("#g-host-controls:not([hidden])");
await b.goto(roomUrl);
await b.fill("#g-name", "Baraka");
await b.click("#g-join-form button");
await b.waitForSelector("#g-wait:not([hidden])");
await a.waitForFunction(() => document.querySelectorAll("#g-players li").length === 2);
console.log("ok create + share link + join");

await a.selectOption("#g-rounds", "1");
await a.selectOption("#g-seconds", "60");
await a.click("#g-startgame");
await a.waitForSelector("#g-play:not([hidden]) #g-rack .tile");
await b.waitForSelector("#g-play:not([hidden]) #g-rack .tile");
const rackA = await a.$$eval("#g-rack .tile", (ts) => ts.map((t) => t.dataset.letter).join(""));
const rackB = await b.$$eval("#g-rack .tile", (ts) => ts.map((t) => t.dataset.letter).join(""));
assert.equal(rackA, rackB);
assert.equal(await a.isVisible("#g-share"), false); // invite box only in the lobby
console.log("ok same rack for both:", rackA);

// a word not spellable from the rack
const missing = "abcdefghijklmnoprstuvwyz".split("").find((c) => !rackA.includes(c));
await a.fill("#g-word", missing.repeat(3));
await a.click("#g-word-form button[type=submit]");
await a.waitForFunction(() => /letters that aren/.test(document.querySelector("#g-mywords").textContent));
// tap tiles to build a 3-letter word, then challenge it if the checker rejects it
const letters = rackA.replace(/\?/g, "").slice(0, 3);
await a.fill("#g-word", "");
for (const ch of letters) await a.click(`#g-rack .tile[data-letter="${ch}"]:not(.used)`);
assert.equal(await a.inputValue("#g-word"), letters);
await a.click("#g-word-form button[type=submit]");
await a.waitForFunction((w) => [...document.querySelectorAll("#g-mywords li")].some((li) => li.textContent.startsWith(w)), letters);
const challenge = await a.$(`[data-challenge="${letters}"]`);
if (challenge) {
  await challenge.click();
  await b.waitForSelector(".vote button[data-v='1']");
  await b.click(".vote button[data-v='1']");
  await a.waitForFunction(() => /accepted by vote/.test(document.querySelector("#g-mywords").textContent));
  console.log(`ok "${letters}" rejected by the checker, accepted by Baraka's vote`);
  assert.equal(await a.inputValue("#g-word"), "");
} else {
  console.log(`ok "${letters}" was accepted by the checker directly`);
}
await a.waitForFunction(() => document.querySelector("#g-players").textContent.match(/Amina[^0-9]*\s(\d+)/) && !/Amina \(you\) ★\s+0\b/.test(document.querySelector("#g-players").textContent));
const t1 = await a.textContent("#g-timer");
await a.waitForTimeout(2200);
assert.ok(parseInt(await a.textContent("#g-timer")) < parseInt(t1), "timer counts down");
if (process.env.SCREENSHOT_DIR) {
  await a.screenshot({ path: join(process.env.SCREENSHOT_DIR, "game_host.png"), fullPage: true });
  await b.screenshot({ path: join(process.env.SCREENSHOT_DIR, "game_phone.png"), fullPage: true });
}
assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log("GAME E2E OK");
