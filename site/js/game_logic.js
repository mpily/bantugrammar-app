// Pure helpers for the multiplayer word race (protocol: docs/space_api.md, "Multiplayer word race").

export function wsUrl(apiBase, wsPath) {
  return apiBase.replace(/^http/, "ws") + wsPath;
}

export function shareUrl(pageHref, code) {
  const u = new URL(pageHref);
  u.search = "";
  u.hash = "";
  u.searchParams.set("room", code);
  return u.toString();
}

export function roomFromUrl(href) {
  const code = new URL(href).searchParams.get("room") || "";
  return /^[A-Za-z]{5}$/.test(code) ? code.toUpperCase() : null;
}

// Seconds left, using the server's clock (ends_at - server_time) and how long ago the state arrived.
export function secondsLeft(state, receivedAtMs, nowMs = Date.now()) {
  if (!state || !state.ends_at || !state.server_time) return 0;
  const left = state.ends_at - state.server_time - (nowMs - receivedAtMs) / 1000;
  return Math.max(0, Math.ceil(left));
}

export function rankPlayers(players) {
  return [...(players || [])].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export const REASON_TEXT = {
  not_in_rack: "uses letters that aren't in this round's tiles",
  already_played: "you already played this word",
  too_short_or_spaces: "too short (or contains a space)",
  unknown_root: "the checker doesn't know this verb root",
  illegal_affix_sequence: "the checker doesn't allow these prefixes/suffixes",
  not_in_dictionary: "not in the checker's dictionary",
};

export function reasonText(reason) {
  return REASON_TEXT[reason] || reason || "rejected";
}

// Remaining tiles after typing `word` (tap-to-type): '?' blanks cover missing letters.
export function remainingTiles(rack, word) {
  const left = rack.map((t) => t.letter);
  for (const ch of [...(word || "").toLowerCase()].filter((c) => !"'’ ".includes(c))) {
    const i = left.indexOf(ch);
    if (i >= 0) left.splice(i, 1);
    else {
      const b = left.indexOf("?");
      if (b >= 0) left.splice(b, 1);
      else return null; // not spellable from the rack
    }
  }
  return left;
}

export function whatsappLink(url) {
  return "https://wa.me/?text=" + encodeURIComponent(`Join my Kitaita word game: ${url}`);
}
