// Pure helpers for the reviewer page (contract: docs/space_api.md, "Reviewing").

export const STATUS_TEXT = {
  player_accepted: "accepted by players (unverified)",
  verified: "verified",
  rejected_by_rooms: "voted down by players",
  declined: "declined by a reviewer",
};

export const WORD_TYPES = ["noun", "verb", "adjective", "other"];

// Body for POST /api/player_words/review, or {error} if the form is inconsistent.
export function buildReview(word, approve, { translation = "", wordType = "", nounClass = "" } = {}) {
  const body = { word, approve };
  const t = translation.trim();
  if (t) body.translation = t.slice(0, 200);
  if (wordType) {
    if (!WORD_TYPES.includes(wordType)) return { error: `unknown word type ${wordType}` };
    body.word_type = wordType;
  }
  if (nounClass) {
    if (wordType !== "noun") return { error: "a noun class can only be set for nouns" };
    body.noun_class = nounClass;
  }
  return { body };
}

export function classLabel(c) {
  const sw = c.nearest_swahili_class ? `Sw. cl. ${c.nearest_swahili_class}` : "no Swahili match";
  const num = c.number && !["unknown", "n/a"].includes(c.number) ? `, ${c.number}` : "";
  const ex = (c.examples || []).length ? ` — e.g. ${c.examples.slice(0, 3).join(", ")}` : "";
  return `${c.id} (${sw}${num})${ex}`;
}

// Picker options: the server's class ids, labelled with examples where the app knows them.
export function classOptions(serverIds, appClasses) {
  const byId = new Map((appClasses || []).map((c) => [c.id, c]));
  const ids = (serverIds && serverIds.length ? serverIds : [...byId.keys()]).slice().sort();
  return ids.map((id) => ({ id, label: byId.has(id) ? classLabel(byId.get(id)) : id }));
}

export function filterQueue(words, filter) {
  if (filter === "todo") return words.filter((w) => !w.review);
  if (filter === "approved") return words.filter((w) => w.review && w.review.approved);
  if (filter === "declined") return words.filter((w) => w.review && !w.review.approved);
  return words;
}

export function reviewSummary(review) {
  if (!review) return "not reviewed yet";
  const parts = [review.approved ? "approved" : "declined"];
  if (review.word_type) parts.push(review.word_type + (review.noun_class ? `, class ${review.noun_class}` : ""));
  if (review.translation) parts.push(`“${review.translation}”`);
  return parts.join(" · ") + ` (${(review.reviewed_at || "").slice(0, 10)})`;
}
