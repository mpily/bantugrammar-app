// Reviewer page: approve/decline player-accepted words with meaning, word type and noun class.
import { makeClient } from "./api.js";
import { withVersion } from "./config.js";
import { buildReview, classOptions, filterQueue, reviewSummary, STATUS_TEXT, WORD_TYPES } from "./review_logic.js";
import { load, save } from "./storage.js";
import { esc } from "./views.js";

const $ = (s) => document.querySelector(s);
const banner = $("#waking");
const api = makeClient({
  onWaking: (n, ms) => {
    banner.hidden = false;
    banner.textContent = `Waking up the server… (retry ${n}, next in ${Math.round(ms / 1000)} s)`;
  },
});

let key = load("bg.reviewer_key", "");
let queue = [];
let options = [];
let appClasses = [];

fetch(withVersion("data/kitaita_classes.json")).then((r) => r.json()).then((d) => { appClasses = d.classes; }).catch(() => {});

if (key) {
  $("#rv-key").value = key;
  $("#rv-forget").hidden = false;
  loadQueue();
}

$("#rv-key-form").addEventListener("submit", (e) => {
  e.preventDefault();
  key = $("#rv-key").value.trim();
  loadQueue();
});
$("#rv-forget").addEventListener("click", () => {
  save("bg.reviewer_key", "");
  key = "";
  $("#rv-key").value = "";
  $("#rv-forget").hidden = true;
  $("#rv-main").hidden = true;
  $("#rv-status").textContent = "Key forgotten on this device.";
});
$("#rv-reload").addEventListener("click", loadQueue);
$("#rv-filter").addEventListener("change", render);

async function loadQueue() {
  if (!key) return;
  $("#rv-status").textContent = "Loading…";
  try {
    const res = await api.reviewQueue(key);
    banner.hidden = true;
    save("bg.reviewer_key", key);
    $("#rv-forget").hidden = false;
    queue = res.words;
    options = classOptions(res.noun_classes, appClasses);
    $("#rv-status").textContent = "";
    $("#rv-main").hidden = false;
    render();
  } catch (e) {
    banner.hidden = true;
    $("#rv-main").hidden = true;
    $("#rv-status").textContent = e.status === 403 ? "That reviewer key was not accepted." : "Could not load: " + e.message;
  }
}

function render() {
  const shown = filterQueue(queue, $("#rv-filter").value);
  $("#rv-count").textContent = `${shown.length} of ${queue.length} words`;
  $("#rv-list").innerHTML = shown.length ? shown.map(card).join("") : `<p class="muted">Nothing here.</p>`;
}

function card(w) {
  const r = w.review || {};
  const typeOpts = [`<option value="">— not sure —</option>`]
    .concat(WORD_TYPES.map((t) => `<option value="${t}"${r.word_type === t ? " selected" : ""}>${t}</option>`)).join("");
  const classOpts = [`<option value="">— not sure —</option>`]
    .concat(options.map((o) => `<option value="${esc(o.id)}"${r.noun_class === o.id ? " selected" : ""}>${esc(o.label)}</option>`)).join("");
  return `<form class="review-card" data-word="${esc(w.word)}">
    <div class="row between">
      <span class="review-word">${esc(w.word)}</span>
      <span class="badge badge-${w.status === "verified" ? "verified" : w.status === "player_accepted" ? "machine" : "unknown"}">${esc(STATUS_TEXT[w.status] || w.status)}</span>
    </div>
    <p class="muted small">Accepted in ${w.n_rooms_accepted} room${w.n_rooms_accepted === 1 ? "" : "s"}, voted down in ${w.n_rooms_rejected} · votes ${w.votes_yes} yes / ${w.votes_no} no${w.last_vote_at ? ` · last vote ${esc(w.last_vote_at.slice(0, 10))}` : ""}<br>Review: ${esc(reviewSummary(w.review))}</p>
    <div class="review-fields">
      <label>Translation / meaning <input name="translation" maxlength="200" value="${esc(r.translation || "")}" placeholder="e.g. Swahili: kiti"></label>
      <label>Word type <select name="word_type">${typeOpts}</select></label>
      <label class="noun-class"${r.word_type === "noun" ? "" : " hidden"}>Noun class <select name="noun_class">${classOpts}</select></label>
    </div>
    <div class="row">
      <button type="submit" name="decision" value="approve">Approve</button>
      <button type="submit" name="decision" value="decline" class="secondary">Decline</button>
      <span class="rv-msg small" aria-live="polite"></span>
    </div>
  </form>`;
}

$("#rv-list").addEventListener("change", (e) => {
  if (e.target.name !== "word_type") return;
  const f = e.target.closest("form");
  const isNoun = e.target.value === "noun";
  f.querySelector(".noun-class").hidden = !isNoun;
  if (!isNoun) f.querySelector("select[name=noun_class]").value = "";
});

$("#rv-list").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const approve = (e.submitter && e.submitter.value) !== "decline";
  const msg = f.querySelector(".rv-msg");
  const built = buildReview(f.dataset.word, approve, {
    translation: f.translation.value, wordType: f.word_type.value, nounClass: f.noun_class.value,
  });
  if (built.error) { msg.textContent = built.error; return; }
  f.querySelectorAll("button").forEach((b) => (b.disabled = true));
  msg.textContent = "Saving…";
  try {
    await api.review(key, built.body);
    msg.textContent = approve ? "Approved." : "Declined.";
    await loadQueue();
  } catch (err) {
    msg.textContent = "Not saved: " + err.message;
    f.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});
