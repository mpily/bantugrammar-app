// Drill item building (pure): verified pairs from the Space + verified_vocab.json.
export function buildItems(apiPairs, vocabItems) {
  const items = [];
  const seen = new Set();
  const add = (it, origin) => {
    const key = `${it.swahili.toLowerCase()}|${it.kitaita.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: it.id, swahili: it.swahili, kitaita: it.kitaita, kind: it.kind,
      noun_class: it.noun_class ?? null, level: it.kind === "word" ? 1 : (it.level || 2),
      alternatives: it.accepted_alternatives || [], origin,
    });
  };
  for (const p of apiPairs || []) if (p.status === undefined || p.status === "verified") add(p, "speakers (Space)");
  for (const v of vocabItems || []) add(v, "verified vocabulary list");
  return items;
}

export function filterItems(items, { level = "all", nounClass = "all" } = {}) {
  return items.filter((it) =>
    (level === "all" || (level === "words" ? it.kind === "word" : it.kind === "sentence")) &&
    (nounClass === "all" || it.noun_class === nounClass));
}

export function promptFor(item, direction, rand = Math.random) {
  const dir = direction === "mixed" ? (rand() < 0.5 ? "swh-dav" : "dav-swh") : direction;
  return dir === "swh-dav"
    ? { dir, show: item.swahili, showLang: "Swahili", expected: item.kitaita, expectLang: "Kitaita", alternatives: item.alternatives }
    : { dir, show: item.kitaita, showLang: "Kitaita", expected: item.swahili, expectLang: "Swahili", alternatives: [] };
}
