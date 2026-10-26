// Page wiring: tabs, translator, progress, drills, scrabble.
import { makeClient, ApiError } from "./api.js";
import { MACHINE_LABEL, ORACLE_DATA_FILES, ORACLE_PY_FILES, PYODIDE_URL, TILES_URL, VERIFIED_VOCAB_URL } from "./config.js";
import { buildItems, filterItems, promptFor } from "./drill_logic.js";
import { grade } from "./grading.js";
import { load, save } from "./storage.js";
import { drawRack, makeBag, PREMIUM_ROW, rackUse, scoreWord } from "./scoring.js";
import { esc, histogramBars, kitaitaHtml, lowN, progressLines, slotRows, statusBadge, statusText } from "./views.js";

const $ = (sel, root = document) => root.querySelector(sel);
const banner = $("#waking");

function waking(attempt, delayMs) {
  banner.hidden = false;
  banner.textContent = `Waking up the translator… (the free server sleeps when idle; retry ${attempt}, next in ${Math.round(delayMs / 1000)} s)`;
}
const api = makeClient({ onWaking: waking });

async function withBanner(fn) {
  try {
    return await fn();
  } finally {
    banner.hidden = true;
  }
}

function errorText(err) {
  if (err instanceof ApiError) {
    const detail = err.body && Array.isArray(err.body.detail) ? ": " + err.body.detail.map((d) => d.msg).join("; ") : "";
    return `${err.message}${detail}`;
  }
  return String(err && err.message ? err.message : err);
}

// ------------------------------------------------------------------ tabs
const tabs = [...document.querySelectorAll("[role=tab]")];
const opened = new Set();
function showTab(id) {
  for (const t of tabs) {
    const on = t.dataset.tab === id;
    t.setAttribute("aria-selected", on);
    $("#" + t.dataset.tab).hidden = !on;
  }
  save("bg.tab", id);
  if (!opened.has(id)) {
    opened.add(id);
    ({ progress: loadProgress, drills: initDrills, scrabble: initScrabble }[id] || (() => {}))();
  }
}
tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

// ------------------------------------------------------------------ translator
let current = null;
const speakerId = load("bg.speaker") || "web-" + Math.random().toString(36).slice(2, 12);
save("bg.speaker", speakerId);

$("#tr-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#tr-input").value.trim();
  if (!text) return;
  const out = $("#tr-result");
  out.innerHTML = `<p class="muted">Translating…</p>`;
  $("#fb-form").hidden = true;
  try {
    current = await withBanner(() => api.translate(text));
    renderTranslation(current);
  } catch (err) {
    out.innerHTML = `<p class="error">Could not translate: ${esc(errorText(err))}</p>`;
  }
});

function renderTranslation(r) {
  const rows = slotRows(r.slots);
  const alt = r.verified_alternative
    ? `<p class="alt">Speakers have verified: <strong>${esc(r.verified_alternative.kitaita)}</strong> ${statusBadge("verified")}</p>`
    : "";
  const unknown = r.unknown_words && r.unknown_words.length
    ? `<p class="muted">No Kitaita form known for: ${r.unknown_words.map(esc).join(", ")} (kept as Swahili, marked with ?).</p>`
    : "";
  $("#tr-result").innerHTML = `
    <div class="kitaita">${kitaitaHtml(r)}</div>
    <p>${statusBadge(r.status)} <span class="label">${esc(r.status === "machine" ? MACHINE_LABEL : statusText(r.status))}</span></p>
    ${alt}${unknown}
    <details ${rows.length ? "open" : ""}><summary>Why each prefix changed (${rows.length})</summary>
      ${rows.length ? `<table class="slots"><thead><tr><th>Swahili</th><th>Agreement</th><th>Kitaita form</th><th>Confidence</th></tr></thead><tbody>
        ${rows.map((s) => `<tr><td>${esc(s.slot)}</td><td>${esc(s.explanation)}</td><td>${esc(s.rewritten_to)}</td><td>${esc(s.confidence)}${s.verified ? " ✓" : ""}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">The pipeline recorded no agreement slots for this sentence.</p>`}
    </details>
    ${r.flags && r.flags.length ? `<details><summary>Pipeline notes (${r.flags.length})</summary><ul>${r.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></details>` : ""}
    <p class="muted small">Pipeline ${esc(r.pipeline_version)} · ${r.latency_ms} ms${r.cached ? " (cached)" : ""}</p>`;
  $("#fb-form").hidden = false;
  $("#fb-status").textContent = "";
  $("#fb-native").value = "";
  document.querySelectorAll("input[name=stars]").forEach((i) => (i.checked = false));
}

$("#fb-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!current) return;
  const stars = Number(new FormData(e.target).get("stars")) || null;
  const native = $("#fb-native").value.trim() || null;
  const name = $("#fb-name").value.trim() || null;
  const consent = $("#fb-consent").checked;
  if (!stars && !native) {
    $("#fb-status").textContent = "Pick a star rating or type the correct Kitaita.";
    return;
  }
  $("#fb-status").textContent = "Sending…";
  try {
    const res = await withBanner(() => api.feedback({
      translation_id: current.id, stars, native_output: native, speaker_id: speakerId,
      channel: "web", speaker_name: consent ? name : null, name_consent: consent && !!name,
    }));
    $("#fb-status").innerHTML = `Asante! Saved. This translation is now ${statusBadge(res.translation_status)}${res.promoted ? " — promoted to verified!" : ""}`;
  } catch (err) {
    $("#fb-status").textContent = "Not saved: " + errorText(err);
  }
});

// ------------------------------------------------------------------ progress
async function loadProgress() {
  const box = $("#progress-body");
  box.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const p = await withBanner(() => api.progress());
    const c = p.counts;
    const bars = histogramBars(p.star_histogram);
    box.innerHTML = `
      <div class="cards">
        ${[["Translations", c.translations], ["Feedback", c.feedback], ["Speakers", c.unique_speakers], ["Verified pairs", c.verified_pairs]]
          .map(([l, v]) => `<div class="card"><div class="big">${v}</div><div class="muted">${l}</div></div>`).join("")}
      </div>
      <table class="stats"><tbody>
        ${progressLines(p).map((l) => `<tr><th>${esc(l.label)}</th><td class="big2">${esc(l.value)}</td><td class="muted">${esc(l.detail)}${l.low ? ' <span class="lown">low n</span>' : ""}</td></tr>`).join("")}
      </tbody></table>
      <h3>Star ratings (n = ${p.mean_stars.n})${lowN(p.mean_stars)}</h3>
      <div class="hist">${bars.map((b) => `<div class="hrow"><span>${b.stars}★</span><span class="bar" style="width:${b.width}%"></span><span>${b.count}</span></div>`).join("")}</div>
      <h3>By day</h3>
      <table class="stats"><thead><tr><th>Date</th><th>Translations</th><th>Feedback</th><th>Mean stars (n)</th></tr></thead><tbody>
        ${p.trend.map((d) => `<tr><td>${esc(d.date)}</td><td>${d.translations}</td><td>${d.feedback}</td><td>${d.mean_stars == null ? "—" : d.mean_stars.toFixed(2)} (${d.rated})${d.low_n ? ' <span class="lown">low n</span>' : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No data yet</td></tr>`}
      </tbody></table>
      <p class="muted small">Computed by the Space at ${esc(p.generated_at)}. "Low n" = fewer than ${p.low_n_threshold} observations.</p>`;
  } catch (err) {
    box.innerHTML = `<p class="error">Could not load progress: ${esc(errorText(err))}</p>`;
  }
}
$("#progress-refresh").addEventListener("click", loadProgress);

// ------------------------------------------------------------------ drills
let drillItems = [];
let drillCurrent = null;
const drillStats = load("bg.drills", { seen: 0, correct: 0, streak: 0, best: 0 });

async function initDrills() {
  const note = $("#drill-source");
  let pairs = [];
  try {
    const res = await withBanner(() => api.verifiedPairs());
    pairs = res.pairs;
    save("bg.pairs", { fetched_at: new Date().toISOString(), pairs });
    note.textContent = `${pairs.length} speaker-verified pairs from the translator.`;
  } catch (err) {
    const cached = load("bg.pairs");
    pairs = cached ? cached.pairs : [];
    note.textContent = cached
      ? `Translator unreachable: using ${pairs.length} cached pairs from ${cached.fetched_at.slice(0, 10)}.`
      : "Translator unreachable and nothing cached yet: using the verified vocabulary list only.";
  }
  let vocab = [];
  try {
    vocab = (await (await fetch(VERIFIED_VOCAB_URL)).json()).items;
  } catch { /* the page still works with the API pairs */ }
  drillItems = buildItems(pairs, vocab);
  note.textContent += ` ${vocab.length} words from the verified vocabulary list. Total n = ${drillItems.length}.`;
  const classes = [...new Set(drillItems.map((i) => i.noun_class).filter(Boolean))].sort();
  $("#drill-class").innerHTML = `<option value="all">all classes</option>` + classes.map((c) => `<option value="${esc(c)}">${esc(c)}-</option>`).join("");
  nextDrill();
}

function renderDrillStats() {
  $("#drill-stats").textContent = `Seen ${drillStats.seen} · correct ${drillStats.correct} · streak ${drillStats.streak} (best ${drillStats.best})`;
}

function nextDrill() {
  const pool = filterItems(drillItems, { level: $("#drill-level").value, nounClass: $("#drill-class").value });
  $("#drill-feedback").textContent = "";
  $("#drill-answer").value = "";
  renderDrillStats();
  if (!pool.length) {
    drillCurrent = null;
    $("#drill-prompt").innerHTML = `<p class="muted">No verified items for this selection yet.</p>`;
    return;
  }
  const item = pool[Math.floor(Math.random() * pool.length)];
  drillCurrent = { item, ...promptFor(item, $("#drill-dir").value) };
  $("#drill-prompt").innerHTML = `<div class="muted small">${esc(drillCurrent.showLang)} → ${esc(drillCurrent.expectLang)}${item.noun_class ? ` · class ${esc(item.noun_class)}-` : ""}</div>
    <div class="prompt">${esc(drillCurrent.show)}</div>`;
  $("#drill-answer").placeholder = `Type the ${drillCurrent.expectLang}`;
  $("#drill-answer").focus();
}

$("#drill-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!drillCurrent) return;
  const g = grade($("#drill-answer").value, drillCurrent.expected, drillCurrent.alternatives);
  if (g.result === "empty") return;
  drillStats.seen++;
  if (g.result === "correct") {
    drillStats.correct++;
    drillStats.streak++;
    drillStats.best = Math.max(drillStats.best, drillStats.streak);
  } else {
    drillStats.streak = 0;
  }
  save("bg.drills", drillStats);
  renderDrillStats();
  $("#drill-feedback").innerHTML = {
    correct: `<span class="ok">Correct!</span>`,
    almost: `<span class="almost">Almost — expected <strong>${esc(g.expected)}</strong></span>`,
    wrong: `<span class="bad">Not quite — expected <strong>${esc(g.expected)}</strong></span>`,
  }[g.result];
});
$("#drill-next").addEventListener("click", nextDrill);
["#drill-level", "#drill-class", "#drill-dir"].forEach((s) => $(s).addEventListener("change", nextDrill));

// ------------------------------------------------------------------ scrabble
let pyodide = null;
let tiles = null;
let rack = [];

async function initScrabble() {
  const status = $("#sc-status");
  try {
    tiles = await (await fetch(TILES_URL)).json();
    renderTiles();
    newRack();
  } catch (err) {
    status.textContent = "Could not load tiles: " + err;
    return;
  }
  status.textContent = "Loading the word checker (Python in your browser; first load downloads ~10 MB)…";
  const t0 = performance.now();
  try {
    await loadScript(PYODIDE_URL);
    pyodide = await globalThis.loadPyodide();
    await pyodide.loadPackage("pyyaml");
    pyodide.FS.mkdirTree("/oracle/kitaita_oracle");
    pyodide.FS.mkdirTree("/oracle/data");
    await Promise.all([...ORACLE_PY_FILES, ...ORACLE_DATA_FILES].map(async (f) => {
      const text = await (await fetch(f)).text();
      pyodide.FS.writeFile("/oracle/" + f, text);
    }));
    pyodide.runPython(`import sys; sys.path.insert(0, "/oracle")\nfrom kitaita_oracle import analyse, get_oracle\nget_oracle()`);
    // words players accepted by vote in the multiplayer game (unverified unless verified); best effort
    makeClient({ delays: [] }).playerWords().then((r) => {
      pyodide.globals.set("_pw", JSON.stringify(r.words));
      pyodide.runPython("import json; get_oracle().set_player_words(json.loads(_pw))");
    }).catch(() => {});
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    status.textContent = `Word checker ready (loaded in ${secs} s).`;
    globalThis.__oracleLoadSeconds = Number(secs);
    $("#sc-form button").disabled = false;
  } catch (err) {
    status.textContent = "Could not load the word checker: " + err;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

function analyse(word) {
  pyodide.globals.set("_word", word);
  return JSON.parse(pyodide.runPython("import json; json.dumps(analyse(_word))"));
}

function renderTiles() {
  const inBag = tiles.tiles.filter((t) => t.in_bag);
  $("#sc-tiles").innerHTML = `
    <p class="muted small">Tile set ${esc(tiles.tile_set_version)} · scores from letter frequencies over n = ${tiles.n_word_types.toLocaleString()} word types
    (${tiles.n_word_tokens.toLocaleString()} tokens) of the ${esc(tiles.corpus)}.</p>
    <div class="tilegrid">${inBag.map((t) => `<div class="tile" title="${t.count} occurrences${t.low_n ? " (low n)" : ""}"><b>${esc(t.grapheme)}</b><sub>${t.score}</sub><small>×${t.bag}</small></div>`).join("")}
      <div class="tile" title="blank"><b>?</b><sub>0</sub><small>×${tiles.blank.bag}</small></div></div>
    ${tiles.tiles.some((t) => !t.in_bag) ? `<p class="muted small">Not in the bag (never seen in the corpus): ${tiles.tiles.filter((t) => !t.in_bag).map((t) => t.grapheme).join(", ")}.</p>` : ""}`;
}

function newRack() {
  rack = drawRack(makeBag(tiles));
  $("#sc-rack").innerHTML = rack.map((l) => `<span class="tile small-tile"><b>${esc(l)}</b><sub>${l === "?" ? 0 : tiles.tiles.find((t) => t.grapheme === l).score}</sub></span>`).join("");
}
$("#sc-newrack").addEventListener("click", newRack);

$("#sc-start").innerHTML = PREMIUM_ROW.map((sq, i) => `<option value="${i}">${i + 1}${sq ? " (" + sq + ")" : ""}</option>`).join("");

$("#sc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!pyodide) return;
  const word = $("#sc-word").value.trim();
  if (!word) return;
  const result = analyse(word);
  const use = rackUse(word, rack);
  const s = scoreWord(word, result, tiles, { start: Number($("#sc-start").value), blanks: use.blanks });
  $("#sc-result").dataset.word = word;
  const parses = result.parses.map((p) => `<li><b>${esc(p.word_type)}</b>: ${p.slots.map((sl) =>
      `<span class="seg${sl.unverified ? " unv" : ""}" title="${esc(sl.slot)}${sl.gloss ? ": " + esc(sl.gloss) : ""}${sl.underlying ? " (from " + esc(sl.underlying) + ")" : ""}${sl.source && sl.source !== "curated" ? " [root " + esc(sl.source) + " — unverified]" : ""}">${esc(sl.form || "∅")}</span>`).join("")}
      ${p.swahili_equivalent ? ` ≈ Sw. <i>${esc(p.swahili_equivalent)}</i>` : ""}
      ${p.uses_unverified_rules ? ` <span class="badge badge-machine" title="${esc((p.unverified_items || []).join(", "))}">relies on unverified data</span>` : ` <span class="badge badge-verified">verified data</span>`}</li>`).join("");
  $("#sc-result").innerHTML = s.valid
    ? `<p class="ok">Valid — <strong>${s.score} points</strong>${s.wordMultiplier > 1 ? ` (word ×${s.wordMultiplier})` : ""}${use.fromRack ? "" : ` · <span class="muted">not playable from your rack (missing ${use.missing.join(", ")})</span>`}</p>
       <p class="muted small">${s.breakdown.map((b) => `${esc(b.letter)}=${b.points}${b.square ? "<sup>" + b.square + "</sup>" : ""}${b.low_n ? "*" : ""}`).join(" + ")}</p>
       <p class="small">${result.parses.length} analys${result.parses.length === 1 ? "is" : "es"}:</p><ul class="parses">${parses}</ul>`
    : `<p class="bad">Not a valid word — 0 points. Reason: <code>${esc(result.reason)}</code></p><p class="muted small">${esc(REASON_TEXT[result.reason] || "")}</p>`;
});

const REASON_TEXT = {
  unknown_root: "The prefixes are fine, but the verb root is not in our root list (it may be a real word we don't know yet).",
  illegal_affix_sequence: "The root is known, but the prefixes in front of it are not a combination our grammar tables allow.",
  not_in_dictionary: "Not a noun or closed-class word in the dictionary, and not a verb or adjective form we can build.",
};

// ------------------------------------------------------------------ start
showTab(load("bg.tab") || "translator");
