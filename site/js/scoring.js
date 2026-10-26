// Scrabble scoring: oracle validity first, then letters x tile scores x premium squares.
// Tiles are single letters (decision 2026-10-26); apostrophes are ignored.

export const PREMIUM_ROW = ["TW", "", "", "DL", "", "", "", "DW", "", "", "", "DL", "", "", "TW"]; // row 8 of a standard board

export function letters(word) {
  return [...(word || "").normalize("NFC").toLowerCase()].filter((c) => !"'’‘ʼ`".includes(c));
}

export function tileMap(tiles) {
  const m = new Map();
  for (const t of tiles.tiles) m.set(t.grapheme, t);
  return m;
}

// -> { valid, score, breakdown[], reason }
export function scoreWord(word, oracleResult, tiles, { start = 0, blanks = [] } = {}) {
  if (!oracleResult || !oracleResult.valid) {
    return { valid: false, score: 0, breakdown: [], reason: oracleResult ? oracleResult.reason : "not checked" };
  }
  const map = tileMap(tiles);
  const ls = letters(word);
  if (start < 0 || start + ls.length > PREMIUM_ROW.length) {
    return { valid: true, score: 0, breakdown: [], reason: "does_not_fit_row" };
  }
  let sum = 0, wordMult = 1;
  const breakdown = ls.map((ch, i) => {
    const sq = PREMIUM_ROW[start + i];
    const t = map.get(ch);
    const base = blanks.includes(i) ? 0 : t && t.score != null ? t.score : 0;
    const letterMult = sq === "DL" ? 2 : sq === "TL" ? 3 : 1;
    if (sq === "DW") wordMult *= 2;
    if (sq === "TW") wordMult *= 3;
    sum += base * letterMult;
    return { letter: ch, base, square: sq, points: base * letterMult, low_n: !!(t && t.low_n), blank: blanks.includes(i) };
  });
  return { valid: true, score: sum * wordMult, wordMultiplier: wordMult, breakdown, reason: null };
}

// Which rack tiles a word uses; missing letters can be covered by blanks.
export function rackUse(word, rack) {
  const pool = [...rack];
  const missing = [];
  const blanks = [];
  letters(word).forEach((ch, i) => {
    const j = pool.indexOf(ch);
    if (j >= 0) pool.splice(j, 1);
    else {
      const b = pool.indexOf("?");
      if (b >= 0) { pool.splice(b, 1); blanks.push(i); } else missing.push(ch);
    }
  });
  return { fromRack: missing.length === 0, missing, blanks };
}

export function makeBag(tiles) {
  const bag = [];
  for (const t of tiles.tiles) for (let i = 0; i < t.bag; i++) bag.push(t.grapheme);
  for (let i = 0; i < tiles.blank.bag; i++) bag.push("?");
  return bag;
}

export function drawRack(bag, n = 7, rand = Math.random) {
  const b = [...bag];
  const rack = [];
  while (rack.length < n && b.length) rack.push(b.splice(Math.floor(rand() * b.length), 1)[0]);
  return rack;
}
