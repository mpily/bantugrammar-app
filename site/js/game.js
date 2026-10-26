// Multiplayer Kitaita word race: page wiring. The Space runs the room and checks words.
import { makeClient } from "./api.js";
import { API_BASE } from "./config.js";
import { rankPlayers, reasonText, remainingTiles, roomFromUrl, secondsLeft, shareUrl, whatsappLink, wsUrl } from "./game_logic.js";
import { load, save } from "./storage.js";
import { esc } from "./views.js";

const $ = (s) => document.querySelector(s);
const banner = $("#waking");
const api = makeClient({
  onWaking: (n, ms) => {
    banner.hidden = false;
    banner.textContent = `Waking up the game server… (it sleeps when idle; retry ${n}, next in ${Math.round(ms / 1000)} s)`;
  },
});

let ws = null;
let me = null;          // {player_id, name}
let state = null;
let stateAt = 0;
let myWords = [];       // [{word, valid, points, reason, votable, status}]
let pingTimer = null;
let tickTimer = null;

const code = roomFromUrl(location.href);

// ------------------------------------------------------------------ start / join
if (!code) {
  $("#g-start").hidden = false;
} else {
  $("#g-start").hidden = true;
  $("#g-join").hidden = false;
  $("#g-join-code").textContent = code;
  $("#g-name").value = load("bg.game.name", "");
  checkRoom();
}

$("#g-create").addEventListener("click", async () => {
  $("#g-start-status").textContent = "Creating a room…";
  try {
    const r = await api.request("/api/game/rooms", { method: "POST" });
    banner.hidden = true;
    const next = new URL(shareUrl(location.href, r.code));
    const devApi = new URLSearchParams(location.search).get("api"); // local development only (see config.js)
    if (devApi) next.searchParams.set("api", devApi);
    location.href = next.toString();
  } catch (e) {
    banner.hidden = true;
    $("#g-start-status").textContent = "Could not create a room: " + e.message;
  }
});

async function checkRoom() {
  try {
    const info = await api.request(`/api/game/rooms/${code}`);
    banner.hidden = true;
    if (!info.exists) {
      $("#g-join-status").innerHTML = `This room doesn't exist (any more). <a href="game.html">Create a new room</a>.`;
      $("#g-join-form button").disabled = true;
    } else {
      $("#g-join-status").textContent = `${info.n_players} player${info.n_players === 1 ? "" : "s"} here · ${info.phase}`;
    }
  } catch (e) {
    banner.hidden = true;
    $("#g-join-status").textContent = "Could not reach the game server: " + e.message;
  }
}

$("#g-join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#g-name").value.trim();
  if (!name) return;
  save("bg.game.name", name);
  connect(name);
});

function connect(name) {
  $("#g-join-status").textContent = "Connecting…";
  ws = new WebSocket(wsUrl(API_BASE, `/ws/game/${code}`));
  ws.onopen = () => ws.send(JSON.stringify({ type: "join", name }));
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    clearInterval(pingTimer);
    if (me) toast("Disconnected from the room. Reload the page to rejoin (your score restarts).", true);
    else $("#g-join-status").textContent = "Could not join the room.";
  };
  pingTimer = setInterval(() => ws && ws.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })), 25000);
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ------------------------------------------------------------------ messages
function handle(m) {
  switch (m.type) {
    case "welcome":
      me = m;
      $("#g-join").hidden = true;
      $("#g-room").hidden = false;
      $("#g-code").textContent = m.room;
      break;
    case "state": {
      const newRound = !state || state.round !== m.round || (state.phase !== "round" && m.phase === "round");
      state = m;
      stateAt = Date.now();
      if (newRound && m.phase === "round") {
        myWords = [];
        $("#g-word").value = "";
      }
      render();
      break;
    }
    case "word_result":
      myWords.unshift({ ...m, status: m.valid ? "scored" : "rejected" });
      if (m.valid) $("#g-word").value = "";
      renderMyWords();
      renderRack();
      break;
    case "vote_pending":
      markWord(m.word, { status: "voting", vote_id: m.vote_id });
      toast(`Asked ${m.n_voters} player${m.n_voters === 1 ? "" : "s"} to vote on “${m.word}”…`);
      break;
    case "vote_request":
      showVote(m);
      break;
    case "vote_result":
      $(`#vote-${m.vote_id}`)?.remove();
      if (me && m.by === me.name) markWord(m.word, { status: m.accepted ? "accepted" : "vote_rejected", points: m.points });
      toast(`“${m.word}” by ${m.by}: ${m.accepted ? `accepted (${m.yes}–${m.no}), +${m.points}` : `not accepted (${m.yes}–${m.no})`}`);
      break;
    case "error":
      if (m.fatal) $("#g-join-status").textContent = m.message;
      else toast(m.message, true);
      break;
  }
}

function markWord(word, patch) {
  const w = myWords.find((x) => x.word === word);
  if (w) Object.assign(w, patch);
  renderMyWords();
}

// ------------------------------------------------------------------ rendering
function render() {
  const isHost = me && state.host === me.player_id;
  const phaseText = { lobby: "waiting to start", round: `round ${state.round} of ${state.rounds}`,
                      reveal: `end of round ${state.round}`, final: "game over" }[state.phase];
  $("#g-phase").textContent = phaseText;
  const url = shareUrl(location.href, state.room);
  $("#g-share").hidden = !(state.phase === "lobby" || state.phase === "final");
  $("#g-share-url").value = url;
  $("#g-wa").href = whatsappLink(url);
  $("#g-lobby").hidden = !(state.phase === "lobby" || state.phase === "final");
  $("#g-host-controls").hidden = !isHost;
  $("#g-wait").hidden = isHost;
  $("#g-wait").textContent = state.phase === "final" ? "Waiting for the host to start a new game…" : "Waiting for the host to start…";
  $("#g-startgame").textContent = state.phase === "final" ? "Play again" : "Start game";
  $("#g-play").hidden = state.phase !== "round";
  renderPlayers();
  renderRack();
  renderMyWords();
  renderReveal();
  clearInterval(tickTimer);
  tickTimer = setInterval(renderTimer, 250);
  renderTimer();
}

function renderTimer() {
  const s = state && (state.phase === "round" || state.phase === "reveal") ? secondsLeft(state, stateAt) : null;
  $("#g-timer").textContent = s == null ? "" : `${s}s`;
  $("#g-timer").classList.toggle("urgent", s != null && s <= 10 && state.phase === "round");
}

function renderPlayers() {
  $("#g-players").innerHTML = rankPlayers(state.players).map((p) =>
    `<li class="${p.connected ? "" : "muted"}">${esc(p.name)}${me && p.id === me.player_id ? " (you)" : ""}${p.id === state.host ? " ★" : ""}
     <span class="pts">${p.score}</span>${state.phase === "round" ? ` <span class="muted small">${p.n_words} word${p.n_words === 1 ? "" : "s"}</span>` : ""}</li>`).join("");
}

function renderRack() {
  if (!state || state.phase !== "round") return;
  const typed = $("#g-word").value;
  const left = remainingTiles(state.rack, typed);
  const used = [...state.rack.map((t) => t.letter)];
  if (left) for (const l of left) used.splice(used.indexOf(l), 1);
  const usedCount = {};
  for (const l of used) usedCount[l] = (usedCount[l] || 0) + 1;
  $("#g-rack").innerHTML = state.rack.map((t, i) => {
    const isUsed = usedCount[t.letter] > 0 ? (usedCount[t.letter]--, true) : false;
    return `<button type="button" class="tile${isUsed ? " used" : ""}" data-letter="${esc(t.letter)}" data-i="${i}"><b>${esc(t.letter === "?" ? "?" : t.letter)}</b><sub>${t.score}</sub></button>`;
  }).join("");
  $("#g-word").classList.toggle("bad-input", left === null && typed.length > 0);
}

$("#g-rack").addEventListener("click", (e) => {
  const b = e.target.closest("button.tile");
  if (!b || b.classList.contains("used")) return;
  const letter = b.dataset.letter === "?" ? (prompt("Blank tile: which letter?") || "").trim().toLowerCase().slice(0, 1) : b.dataset.letter;
  if (!letter) return;
  $("#g-word").value += letter;
  renderRack();
});
$("#g-word").addEventListener("input", renderRack);
$("#g-clear").addEventListener("click", () => { $("#g-word").value = ""; renderRack(); });

$("#g-word-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const word = $("#g-word").value.trim();
  if (word) send({ type: "word", word });
});

function renderMyWords() {
  $("#g-mywords").innerHTML = myWords.map((w) => {
    let detail;
    if (w.status === "scored") detail = `<span class="ok">+${w.points}</span>${w.unverified ? ' <span class="badge badge-machine" title="the checker accepted it using unverified data">unverified</span>' : ""}`;
    else if (w.status === "voting") detail = `<span class="almost">players are voting…</span>`;
    else if (w.status === "accepted") detail = `<span class="ok">accepted by vote, +${w.points}</span> <span class="badge badge-machine">player-accepted</span>`;
    else if (w.status === "vote_rejected") detail = `<span class="bad">not accepted by vote</span>`;
    else detail = `<span class="bad">${esc(reasonText(w.reason))}</span>${w.votable ? ` <button type="button" class="secondary small-btn" data-challenge="${esc(w.word)}">It's Kitaita! Ask the room</button>` : ""}`;
    return `<li><b>${esc(w.word)}</b> ${detail}</li>`;
  }).join("");
}

$("#g-mywords").addEventListener("click", (e) => {
  const b = e.target.closest("[data-challenge]");
  if (!b) return;
  b.disabled = true;
  send({ type: "challenge", word: b.dataset.challenge });
  if ($("#g-word").value.trim().toLowerCase() === b.dataset.challenge) {
    $("#g-word").value = "";
    renderRack();
  }
});

function showVote(m) {
  const div = document.createElement("div");
  div.className = "vote";
  div.id = `vote-${m.vote_id}`;
  div.innerHTML = `<p><b>${esc(m.by)}</b> says <b>“${esc(m.word)}”</b> is a Kitaita word. Is it?</p>
    <div class="row"><button type="button" data-v="1">Yes, it's Kitaita</button><button type="button" class="secondary" data-v="0">No</button></div>`;
  div.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    send({ type: "vote", vote_id: m.vote_id, accept: b.dataset.v === "1" });
    div.innerHTML = `<p class="muted">You voted on “${esc(m.word)}”. Waiting for the others…</p>`;
  });
  $("#g-votes").appendChild(div);
}

function renderReveal() {
  const show = state.phase === "reveal" || state.phase === "final";
  $("#g-reveal").hidden = !show;
  if (!show) return;
  const ranked = rankPlayers(state.players);
  const title = state.phase === "final" ? `<h3>Winner: ${esc(ranked[0]?.name || "")} 🏆</h3>` : `<h3>Words this round</h3>`;
  $("#g-reveal").innerHTML = title + ranked.map((p) => `<div class="reveal-player"><b>${esc(p.name)}</b>: ${
    (p.words || []).length ? p.words.map((w) => `<span class="seg${w.unverified ? " unv" : ""}" title="${w.how === "vote" ? "accepted by vote" : "accepted by the checker"}${w.unverified ? ", unverified" : ""}">${esc(w.word)} +${w.points}${w.how === "vote" ? " 🗳" : ""}</span>`).join(" ") : '<span class="muted">no words</span>'}</div>`).join("");
}

let toastTimer = null;
function toast(text, bad = false) {
  const t = $("#g-toast");
  t.textContent = text;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 4000);
}

$("#g-startgame").addEventListener("click", () => send({ type: "start", rounds: Number($("#g-rounds").value), seconds: Number($("#g-seconds").value) }));
$("#g-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#g-share-url").value); toast("Link copied"); }
  catch { $("#g-share-url").select(); }
});
