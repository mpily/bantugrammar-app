// Pure view helpers (no DOM access) so they can be unit-tested in Node.
import { MACHINE_LABEL } from "./config.js";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const STATUS_TEXT = {
  machine: MACHINE_LABEL,
  speaker_corrected: "corrected by a native speaker — not yet verified",
  verified: "verified by native speakers",
  unknown: "unknown — no Kitaita form is known for this",
};

export function statusBadge(status) {
  const s = STATUS_TEXT[status] ? status : "unknown";
  return `<span class="badge badge-${s}" title="${esc(STATUS_TEXT[s])}">${esc(s.replace("_", " "))}</span>`;
}

export function statusText(status) {
  return STATUS_TEXT[status] || STATUS_TEXT.unknown;
}

// Kitaita display string: the API's kitaita_marked wraps passed-through Swahili as [?word].
export function kitaitaHtml(resp) {
  if (!resp || !resp.kitaita) return `<span class="unknown">unknown</span>`;
  const marked = resp.kitaita_marked || resp.kitaita;
  return esc(marked).replace(/\[\?([^\]]+)\]/g, '<mark class="unknown-word" title="no Kitaita form known; kept as Swahili">$1?</mark>');
}

const RELATION_TEXT = {
  nsubj: "subject prefix agrees with",
  amod: "adjective agrees with",
  "nmod:poss": "possessive agrees with",
  nmod: "‘of’ particle agrees with",
  det: "determiner agrees with",
};

export function slotRows(slots) {
  return (slots || []).map((s) => ({
    slot: s.slot,
    explanation: `${RELATION_TEXT[s.relation] || s.relation} ${s.controller ? "“" + s.controller + "”" : "(no noun found)"}`,
    rewritten_to: s.rewritten_to ?? "—",
    confidence: s.confidence,
    verified: !!s.verified_form,
  }));
}

export function fmtNum(x, digits = 2) {
  return x == null ? "—" : Number(x).toFixed(digits);
}

export function fmtCI(ci, digits = 2, pct = false) {
  if (!ci) return "CI n/a";
  const f = (v) => (pct ? (v * 100).toFixed(0) + "%" : Number(v).toFixed(digits));
  return `95% CI ${f(ci[0])}–${f(ci[1])}`;
}

export function lowN(stat) {
  return stat && stat.low_n ? ' <span class="lown" title="fewer than 5 observations">low n</span>' : "";
}

// Summary lines for the Progress tab, straight from /api/progress (no statistics computed here).
export function progressLines(p) {
  const pct = (r) => (r == null ? "—" : (r * 100).toFixed(0) + "%");
  return [
    { label: "Mean rating", value: `${fmtNum(p.mean_stars.mean)} / 5`, detail: `${fmtCI(p.mean_stars.ci95)}, n = ${p.mean_stars.n}`, low: p.mean_stars.low_n },
    { label: "Rated 4–5 stars", value: pct(p.four_plus_rate.rate), detail: `${fmtCI(p.four_plus_rate.ci95, 2, true)}, ${p.four_plus_rate.k} of n = ${p.four_plus_rate.n}`, low: p.four_plus_rate.low_n },
    { label: "Exact match with speaker", value: pct(p.exact_match.rate), detail: `${fmtCI(p.exact_match.ci95, 2, true)}, ${p.exact_match.k} of n = ${p.exact_match.n}`, low: p.exact_match.low_n },
    { label: "chrF vs speaker (0–100)", value: fmtNum(p.chrf.mean, 1), detail: `${fmtCI(p.chrf.ci95, 1)}, n = ${p.chrf.n}`, low: p.chrf.low_n },
  ];
}

export function histogramBars(hist) {
  const entries = ["1", "2", "3", "4", "5"].map((k) => [k, hist?.[k] || 0]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([k, v]) => ({ stars: k, count: v, width: Math.round((100 * v) / max) }));
}
