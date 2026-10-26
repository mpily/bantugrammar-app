import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPlayers, reasonText, remainingTiles, roomFromUrl, secondsLeft, shareUrl, whatsappLink, wsUrl } from "../../site/js/game_logic.js";

test("ws URL from the API base", () => {
  assert.equal(wsUrl("https://mpily-bantugrammar.hf.space", "/ws/game/ABCDE"), "wss://mpily-bantugrammar.hf.space/ws/game/ABCDE");
  assert.equal(wsUrl("http://127.0.0.1:7870", "/ws/game/ABCDE"), "ws://127.0.0.1:7870/ws/game/ABCDE");
});

test("share link and room code parsing", () => {
  const u = shareUrl("https://mpily.github.io/bantugrammar-app/game.html?x=1#y", "KQ7MX");
  assert.equal(u, "https://mpily.github.io/bantugrammar-app/game.html?room=KQ7MX");
  assert.equal(roomFromUrl("https://x/game.html?room=kqzmx"), "KQZMX");
  assert.equal(roomFromUrl("https://x/game.html?room=<script>"), null);
  assert.match(whatsappLink(u), /^https:\/\/wa\.me\/\?text=Join/);
});

test("countdown uses the server clock, not the phone's", () => {
  const st = { ends_at: 1000, server_time: 940 }; // 60 s left on the server
  assert.equal(secondsLeft(st, 5_000_000, 5_010_000), 50);
  assert.equal(secondsLeft(st, 0, 999_999_999), 0);
  assert.equal(secondsLeft(null, 0), 0);
});

test("scoreboard order", () => {
  const r = rankPlayers([{ name: "b", score: 3 }, { name: "a", score: 3 }, { name: "c", score: 9 }]);
  assert.deepEqual(r.map((p) => p.name), ["c", "a", "b"]);
});

test("tap-to-type keeps track of tiles, blanks cover missing letters", () => {
  const rack = [..."mundu?"].map((letter) => ({ letter }));
  assert.deepEqual(remainingTiles(rack, "mun"), ["d", "u", "?"]);
  assert.deepEqual(remainingTiles(rack, "mundux"), []);
  assert.equal(remainingTiles(rack, "mundux z"), null);
});

test("reason texts", () => {
  assert.match(reasonText("not_in_rack"), /tiles/);
  assert.equal(reasonText("weird"), "weird");
});
