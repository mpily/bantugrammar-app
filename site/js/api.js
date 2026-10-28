// Thin client for the Space API (contract: docs/space_api.md).
// The free Space sleeps after 48 h idle; the first request can take a minute,
// so transient failures are retried with backoff while the UI says "waking up".
import { API_BASE, API_VERSION } from "./config.js";

export const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000, 30000];
const TRANSIENT = new Set([502, 503, 504]);

// Readable message for any error body: our API's {"error": "..."}, FastAPI's {"detail": ...},
// or a hosting-platform error object such as {"error": {"message": ...}}.
export function errorMessage(status, body) {
  const raw = body && (body.error ?? body.detail ?? body.message);
  let text;
  if (raw == null) text = "";
  else if (typeof raw === "string") text = raw;
  else if (Array.isArray(raw)) text = raw.map((d) => (d && (d.msg || d.message)) || JSON.stringify(d)).join("; ");
  else text = raw.message || raw.msg || raw.type || JSON.stringify(raw);
  text = String(text).slice(0, 300);
  if (!status) return text || "The server could not be reached.";
  return text ? `HTTP ${status}: ${text}` : `HTTP ${status}`;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(errorMessage(status, body));
    this.status = status;
    this.body = body;
  }
}

export function makeClient({ base = API_BASE, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onWaking = () => {}, delays = RETRY_DELAYS_MS } = {}) {
  async function request(path, { method = "GET", body, headers = {} } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(base + path, {
          method,
          headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        res = null; // network error: the Space may be asleep/starting
      }
      const transient = res === null || TRANSIENT.has(res.status) || !isJson(res);
      if (transient && attempt < delays.length) {
        onWaking(attempt + 1, delays[attempt]);
        await sleep(delays[attempt]);
        continue;
      }
      if (res === null) throw new ApiError(0, { error: "The server could not be reached (it may still be starting)." });
      const data = isJson(res) ? await res.json() : null;
      if (!res.ok) throw new ApiError(res.status, data);
      if (data && data.api_version !== API_VERSION) {
        throw new ApiError(res.status, { error: `Unsupported api_version ${data.api_version} (expected ${API_VERSION})` });
      }
      return data;
    }
  }

  return {
    request,
    health: () => request("/api/health"),
    playerWords: () => request("/api/player_words"),
    reviewQueue: (key) => request("/api/player_words/review_queue", { headers: { "X-Reviewer-Key": key } }),
    review: (key, body) => request("/api/player_words/review", { method: "POST", body, headers: { "X-Reviewer-Key": key } }),
    translate: (text) => request("/api/translate", { method: "POST", body: { text, src: "swh", tgt: "dav" } }),
    feedback: (payload) => request("/api/feedback", { method: "POST", body: payload }),
    progress: () => request("/api/progress"),
    verifiedPairs: ({ since, kind } = {}) => {
      const q = new URLSearchParams();
      if (since) q.set("since", since);
      if (kind) q.set("kind", kind);
      const qs = q.toString();
      return request("/api/verified_pairs" + (qs ? "?" + qs : ""));
    },
  };
}

function isJson(res) {
  const ct = (res.headers && (res.headers.get ? res.headers.get("content-type") : res.headers["content-type"])) || "";
  return ct.includes("application/json");
}
