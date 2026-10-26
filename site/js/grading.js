// Client-side grading for drills.
const APOSTROPHES = /[’‘ʼ`]/g;

export function normalize(s) {
  return (s || "")
    .normalize("NFC")
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(/[.,!?;:"“”()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// -> { result: "correct" | "almost" | "wrong" | "empty", expected, matched }
export function grade(answer, expected, alternatives = []) {
  const a = normalize(answer);
  if (!a) return { result: "empty", expected };
  const targets = [expected, ...alternatives].filter(Boolean);
  for (const t of targets) {
    if (normalize(t) === a) return { result: "correct", expected, matched: t };
  }
  for (const t of targets) {
    if (editDistance(normalize(t), a) === 1) return { result: "almost", expected, matched: t };
  }
  return { result: "wrong", expected };
}
