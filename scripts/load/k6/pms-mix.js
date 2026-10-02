// SERENE MANAGEMENT load test (docs/SCALABILITY.md). k6 script, no extra dependencies.
//
//   k6 run -e BASE=http://127.0.0.1:3100 -e ORIGIN=https://pms.serene-bench.test \
//          -e BENCH_PASSWORD=… -e RATE=200 -e DURATION=60s scripts/load/k6/pms-mix.js
//
// Environment:
//   BASE            server under test (default http://127.0.0.1:3100)
//   BASES           several instances, comma-separated: requests spread round-robin
//   ORIGIN          the server's APP_URL origin, sent as Origin on writes (CSRF check)
//   TOKENS          sessions file from scripts/load/login.mjs (preferred: no sign-in per run)
//   BENCH_PASSWORD  otherwise: password of the benchmark users (scripts/load/bench-users.mjs)
//   BENCH_USERS     number of benchmark users to sign in (default 50)
//   RATE            requests (iterations) per second for the constant-rate model
//   STAGES          ramp instead: "50:30s,100:30s,…" (rate:duration list)
//   DURATION        constant-rate duration (default 60s)
//   ONLY            run a single request class (per-endpoint baseline); besides the MIX
//                   classes: healthLive, publicPage, staticAsset, pageFrontDesk, the global
//                   search sources (searchFolios, searchAccounts, searchGroups,
//                   searchMaintenance), globalSearch (the former six requests of one
//                   keystroke, in parallel) and unifiedSearch / unifiedSearchOrg (one request);
//                   anonymous: loginFail, loginOk (needs BENCH_PASSWORD), passwordReset
//   MODE=vus        closed model instead: VUS users back to back for DURATION
//   MIX             JSON object of weights overriding the default mix, e.g. '{"me":1}'
//   PROFILE         "canonical": the final capacity workload (docs/SCALABILITY.md §38.3)
//   SUMMARY         path of the JSON summary written at the end
//   COOKIE          access cookie name (default production "__Host-sm_at")
//
// Every virtual user acts as one of the signed-in staff accounts and sends a stable
// X-Forwarded-For address per account: each account behaves like a user behind its own
// connection, which is what per-IP limits see in production behind one proxy hop.
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:3100";
/**
 * Several instances of the same deployment ("http://h:3100,http://h:3101"): requests
 * are spread round-robin, like a load balancer without session affinity. Sessions
 * live in PostgreSQL, so any instance serves any user.
 */
const BASES = __ENV.BASES ? __ENV.BASES.split(",") : [BASE];
const ORIGIN = __ENV.ORIGIN || "https://pms.serene-bench.test";
const COOKIE = __ENV.COOKIE || "__Host-sm_at";
const USERS = Number(__ENV.BENCH_USERS || 50);

/**
 * Default traffic mix of dynamic API requests (percent). Browser assets, pages and
 * CDN-cacheable traffic are NOT part of this mix: it models what reaches the
 * application and PostgreSQL. Sums to 100.
 */
const DEFAULT_MIX = {
  businessDate: 20, // every open page polls it every 60 s
  me: 5,
  frontDeskSummary: 6,
  arrivals: 8,
  inHouse: 6,
  departures: 4,
  roomBoard: 7,
  housekeepingTasks: 6,
  housekeepingSummary: 3,
  maintenanceSummary: 3,
  dashboard: 4,
  reservationList: 7,
  reservationSearch: 5,
  guestSearch: 4,
  availability: 4,
  folioList: 3,
  folioRead: 3,
  report: 1,
  writeGuestNote: 1,
};

/**
 * Canonical PMS workload (final scalability phase, docs/SCALABILITY.md §38.3): the
 * default mix with the unified global search (one request per keystroke, as the
 * palette sends since phase 2) and the two common desk writes. Percent of user
 * actions; writeRoomStatus is two requests (board read, then the change). Job
 * enqueues are not user requests here: the night audit is a few per property per
 * day, so the capacity runs add a separate low-rate job feed.
 */
const CANONICAL_MIX = {
  businessDate: 16,
  me: 4,
  frontDeskSummary: 5,
  arrivals: 7,
  inHouse: 5,
  departures: 4,
  roomBoard: 7,
  housekeepingTasks: 5,
  housekeepingSummary: 3,
  maintenanceSummary: 2,
  dashboard: 4,
  reservationList: 6,
  reservationSearch: 5,
  guestSearch: 4,
  unifiedSearch: 4,
  availability: 5,
  folioList: 3,
  folioRead: 4,
  report: 1,
  writeGuestNote: 2,
  writeRoomStatus: 4,
};

const mix = __ENV.ONLY
  ? { [__ENV.ONLY]: 1 }
  : __ENV.MIX
    ? JSON.parse(__ENV.MIX)
    : __ENV.PROFILE === "canonical"
      ? CANONICAL_MIX
      : DEFAULT_MIX;
const classes = Object.entries(mix).filter(([, weight]) => weight > 0);
const totalWeight = classes.reduce((sum, [, weight]) => sum + weight, 0);

function scenario() {
  if (__ENV.MODE === "vus") {
    // Closed model: a fixed number of users sending back-to-back requests (capacity probe).
    return {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || "30s",
    };
  }
  if (__ENV.STAGES) {
    const stages = __ENV.STAGES.split(",").map((stage) => {
      const [target, duration] = stage.split(":");
      return { target: Number(target), duration };
    });
    return {
      executor: "ramping-arrival-rate",
      startRate: stages[0].target,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.VUS || 200),
      maxVUs: Number(__ENV.MAX_VUS || 2000),
      stages,
    };
  }
  return {
    executor: "constant-arrival-rate",
    rate: Number(__ENV.RATE || 50),
    timeUnit: "1s",
    duration: __ENV.DURATION || "60s",
    preAllocatedVUs: Number(__ENV.VUS || 200),
    maxVUs: Number(__ENV.MAX_VUS || 2000),
  };
}

// Submetrics (per request class, and the scenario without setup logins) appear in
// the summary only when a threshold references them; these thresholds never fail.
const thresholds = {
  "http_req_duration{scenario:pms}": ["max>=0"],
  // One iteration = one user action; for globalSearch, one keystroke (all its requests).
  "iteration_duration{scenario:pms}": ["max>=0"],
  "http_reqs{scenario:pms}": ["count>=0"],
  "http_req_failed{scenario:pms}": ["rate>=0"],
};
for (const source of [
  "reservationSearch",
  "guestSearch",
  "searchFolios",
  "searchAccounts",
  "searchGroups",
  "searchMaintenance",
]) {
  thresholds[`http_req_duration{source:${source}}`] = ["max>=0"];
}
for (const type of [
  "reservations",
  "guests",
  "rooms",
  "folios",
  "companies",
  "groups",
  "maintenance",
  "ratePlans",
]) {
  thresholds[`server_search_type_ms{type:${type}}`] = ["max>=0"];
}
for (const [name] of classes) {
  thresholds[`http_req_duration{name:${name}}`] = ["max>=0"];
  thresholds[`http_reqs{name:${name}}`] = ["count>=0"];
  thresholds[`response_bytes{name:${name}}`] = ["max>=0"];
  thresholds[`server_auth_ms{name:${name}}`] = ["max>=0"];
  thresholds[`server_total_ms{name:${name}}`] = ["max>=0"];
  thresholds[`http_req_failed{name:${name}}`] = ["rate>=0"];
}

export const options = {
  scenarios: { pms: scenario() },
  thresholds,
  setupTimeout: "300s",
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
  // Keep-alive connections per VU, like browsers behind a load balancer.
  noConnectionReuse: false,
};

const statusCount = new Counter("status_non_2xx");
const roomConflicts = new Counter("room_status_conflicts");
const bodyBytes = new Trend("response_bytes");
// Present only when the server runs with SERVER_TIMING=1.
const serverAuth = new Trend("server_auth_ms", true);
const serverTotal = new Trend("server_total_ms", true);
const serverSearchType = new Trend("server_search_type_ms", true);
// Pool usage per request (db-acquire): waiting for connections, and new connections opened.
const serverDbWait = new Trend("server_db_wait_ms", true);
const serverDbOpened = new Counter("server_db_opened");

function ipFor(index) {
  return `10.77.${Math.floor(index / 250)}.${(index % 250) + 1}`;
}

// Sessions from scripts/load/login.mjs (TOKENS=path) are reused instead of signing in.
const TOKENS = __ENV.TOKENS ? JSON.parse(open(__ENV.TOKENS)).users : null;

export function setup() {
  const password = __ENV.BENCH_PASSWORD;
  const users = TOKENS ? TOKENS.slice(0, USERS) : [];
  if (!TOKENS && !password) throw new Error("BENCH_PASSWORD or TOKENS is required");
  for (let i = 1; !TOKENS && i <= USERS; i++) {
    const email = `bench.user${String(i).padStart(4, "0")}@serene.test`;
    const ip = ipFor(i);
    const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email, password }), {
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": ip },
      tags: { name: "setup" },
    });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.body}`);
    const cookie = res.cookies[COOKIE] && res.cookies[COOKIE][0] && res.cookies[COOKIE][0].value;
    if (!cookie) throw new Error(`login ${email}: no ${COOKIE} cookie`);
    users.push({ cookie, ip });
  }
  const headers = { Cookie: `${COOKIE}=${users[0].cookie}`, "X-Forwarded-For": users[0].ip };
  const me = http.get(`${BASE}/api/v1/me`, { headers, tags: { name: "setup" } }).json("data");
  const properties = me.properties.map((p) => {
    const inHouse = http
      .get(`${BASE}/api/v1/properties/${p.id}/front-desk/in-house?limit=200`, {
        headers,
        tags: { name: "setup" },
      })
      .json("data");
    const bd = http
      .get(`${BASE}/api/v1/properties/${p.id}/business-date`, { headers, tags: { name: "setup" } })
      .json("data");
    return {
      id: p.id,
      code: p.code,
      businessDate: bd.businessDate,
      reservationRooms: inHouse.map((s) => s.reservationRoomId),
    };
  });
  const guests = http
    .get(`${BASE}/api/v1/guests?q=khan&limit=50`, { headers, tags: { name: "setup" } })
    .json("data")
    .map((g) => g.id);
  const loginHtml = http.get(`${BASE}/login`, { tags: { name: "setup" } }).body || "";
  const asset = /\/_next\/static\/[^"']+\.js/.exec(loginHtml);
  return { users, properties, guests, staticAsset: asset ? asset[0] : "/favicon.ico" };
}

// SEARCH_TERM fixes the term (e.g. a broad "al"); otherwise terms rotate.
const FIXED_TERM = __ENV.SEARCH_TERM || null;
const SEARCH_TERMS = [
  "khan",
  "ahmed",
  "smith",
  "malik",
  "zhang",
  "fatima",
  "omar",
  "wilson",
  "haddad",
  "rahman",
];
const pick = (list, n) => list[n % list.length];

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function requestFor(name, data, n) {
  const p = pick(data.properties, n);
  const base = `${BASE}/api/v1/properties/${p.id}`;
  const term = FIXED_TERM || pick(SEARCH_TERMS, n);
  switch (name) {
    case "healthLive":
      return ["GET", `${BASE}/api/health/live`];
    case "publicPage":
      return ["GET", `${BASE}/login`];
    case "staticAsset":
      return ["GET", `${BASE}${data.staticAsset}`];
    case "pageFrontDesk":
      return ["GET", `${BASE}/${p.code}/front-desk`];
    // Sign-in protection (scalability phase 2): anonymous, each from its own address.
    case "loginFail":
      return [
        "POST",
        `${BASE}/api/v1/auth/login`,
        JSON.stringify({ email: `nobody.${n}@bench.test`, password: "Wrong-password-123" }),
      ];
    case "loginOk":
      return [
        "POST",
        `${BASE}/api/v1/auth/login`,
        JSON.stringify({
          email: `bench.user${String((n % USERS) + 1).padStart(4, "0")}@serene.test`,
          password: __ENV.BENCH_PASSWORD,
        }),
      ];
    case "passwordReset":
      return [
        "POST",
        `${BASE}/api/v1/auth/password/reset`,
        JSON.stringify({
          token: `invalid-token-${n}-abcdefghijklmnopqrstuvwxyz`,
          newPassword: "New-password-12345-long",
        }),
      ];
    case "businessDate":
      return ["GET", `${base}/business-date`];
    case "me":
      return ["GET", `${BASE}/api/v1/me`];
    case "frontDeskSummary":
      return ["GET", `${base}/front-desk/summary`];
    case "arrivals":
      return ["GET", `${base}/front-desk/arrivals?limit=50`];
    case "inHouse":
      return ["GET", `${base}/front-desk/in-house?limit=50`];
    case "departures":
      return ["GET", `${base}/front-desk/departures?limit=50`];
    case "roomBoard":
      return ["GET", `${base}/rooms/board`];
    case "housekeepingTasks":
      return ["GET", `${base}/housekeeping/tasks?limit=50`];
    case "housekeepingSummary":
      return ["GET", `${base}/housekeeping/summary`];
    case "maintenanceSummary":
      return ["GET", `${base}/maintenance/summary`];
    case "dashboard":
      return ["GET", `${base}/dashboard`];
    case "reservationList":
      return ["GET", `${base}/reservations?limit=50`];
    case "reservationSearch":
      return ["GET", `${base}/reservations?limit=20&q=${term}`];
    case "guestSearch":
      return ["GET", `${BASE}/api/v1/guests?limit=10&q=${term}`];
    case "availability": {
      const arrival = addDays(p.businessDate, 1 + (n % 30));
      return [
        "GET",
        `${base}/availability?arrival=${arrival}&departure=${addDays(arrival, 1 + (n % 4))}&adults=2`,
      ];
    }
    // Global search sources (lib/api/endpoints/search.api.ts), limit 5 like the palette.
    case "searchFolios":
      return ["GET", `${base}/folios?view=all&limit=5&q=${term}`];
    case "searchAccounts":
      return ["GET", `${BASE}/api/v1/accounts?limit=5&q=${term}`];
    case "searchGroups":
      return ["GET", `${base}/groups?limit=5&q=${term}`];
    case "searchMaintenance":
      return ["GET", `${base}/maintenance?view=all&limit=5&q=${term}`];
    // Unified global search (scalability phase 2): one request per keystroke.
    case "unifiedSearch":
      return ["GET", `${base}/search?q=${term}`];
    case "unifiedSearchOrg":
      return ["GET", `${BASE}/api/v1/search?q=${term}`];
    case "folioList":
      return ["GET", `${base}/folios?view=in_house&limit=50`];
    case "folioRead":
      return ["GET", `${base}/reservation-rooms/${pick(p.reservationRooms, n)}/folio`];
    case "report":
      return ["GET", `${base}/reports/manager-flash`];
    case "writeGuestNote":
      return [
        "POST",
        `${BASE}/api/v1/guests/${pick(data.guests, n)}/notes`,
        JSON.stringify({ body: `Load test note ${n}`, propertyId: p.id }),
      ];
    default:
      throw new Error(`unknown request class ${name}`);
  }
}

function choose(n) {
  let r = (n * 2654435761) % totalWeight;
  if (r < 0) r += totalWeight;
  for (const [name, weight] of classes) {
    if (r < weight) return name;
    r -= weight;
  }
  return classes[0][0];
}

/**
 * Anonymous classes and the statuses that count as handled correctly: a failed
 * sign-in answers 401, an invalid reset token 400 or 401. 429 means a limit
 * refused the request and is counted as a failure.
 */
const ANONYMOUS = {
  loginFail: [401],
  loginOk: [200],
  passwordReset: [400, 401],
};

/** One global-search keystroke (after the debounce): six requests in parallel. */
const GLOBAL_SEARCH = [
  ["reservationSearch", "GET", (b, t) => `${b}/reservations?limit=5&q=${t}`],
  ["guestSearch", "GET", (_b, t) => `${BASE}/api/v1/guests?limit=5&q=${t}`],
  ["searchFolios", "GET", (b, t) => `${b}/folios?view=all&limit=5&q=${t}`],
  ["searchAccounts", "GET", (_b, t) => `${BASE}/api/v1/accounts?limit=5&q=${t}`],
  ["searchGroups", "GET", (b, t) => `${b}/groups?limit=5&q=${t}`],
  ["searchMaintenance", "GET", (b, t) => `${b}/maintenance?view=all&limit=5&q=${t}`],
];

/**
 * A housekeeper's action: read the board, then mark one room clean or dirty with
 * its version (optimistic concurrency). 409 (someone else changed it first) is a
 * correct answer, not a failure.
 */
function roomStatusChange(data, n, user) {
  const p = pick(data.properties, n);
  const url = (path) =>
    BASES.length > 1 ? BASES[n % BASES.length] + path.slice(BASE.length) : path;
  const headers = { Cookie: `${COOKIE}=${user.cookie}`, "X-Forwarded-For": user.ip };
  const board = http.get(url(`${BASE}/api/v1/properties/${p.id}/rooms/board?limit=100`), {
    headers,
    tags: { name: "writeRoomStatus", step: "read" },
  });
  const okRead = board.status === 200;
  check(board, { "2xx": () => okRead }, { name: "writeRoomStatus" });
  if (!okRead) {
    statusCount.add(1, { name: "writeRoomStatus", status: String(board.status) });
    return;
  }
  const rooms = (board.json("data.items") || []).filter(
    (r) => !r.block && (r.housekeepingStatus === "DIRTY" || r.housekeepingStatus === "CLEAN"),
  );
  if (rooms.length === 0) return;
  const room = rooms[n % rooms.length];
  const action = room.housekeepingStatus === "DIRTY" ? "mark-clean" : "mark-dirty";
  const res = http.post(
    url(`${BASE}/api/v1/properties/${p.id}/rooms/${room.id}/${action}`),
    JSON.stringify({ version: room.version }),
    {
      headers: { ...headers, "Content-Type": "application/json", Origin: ORIGIN },
      tags: { name: "writeRoomStatus", step: "write" },
      responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409),
    },
  );
  const ok = res.status === 200 || res.status === 409;
  check(res, { "2xx": () => ok }, { name: "writeRoomStatus" });
  if (!ok) statusCount.add(1, { name: "writeRoomStatus", status: String(res.status) });
  if (res.status === 409) roomConflicts.add(1);
}

export default function pmsIteration(data) {
  const n = __VU * 100003 + __ITER;
  const name = choose(n);
  const user = data.users[n % data.users.length];
  if (name === "globalSearch") {
    const p = pick(data.properties, n);
    const term = FIXED_TERM || pick(SEARCH_TERMS, n);
    const headers = { Cookie: `${COOKIE}=${user.cookie}`, "X-Forwarded-For": user.ip };
    const responses = http.batch(
      GLOBAL_SEARCH.map(([source, method, url]) => ({
        method,
        url: url(`${BASE}/api/v1/properties/${p.id}`, term),
        params: { headers, tags: { name: "globalSearch", source } },
      })),
    );
    for (const res of responses) {
      const ok = res.status >= 200 && res.status < 300;
      check(res, { "2xx": () => ok }, { name });
      if (!ok) statusCount.add(1, { name, status: String(res.status) });
    }
    return;
  }
  if (name === "writeRoomStatus") {
    roomStatusChange(data, n, user);
    return;
  }
  const [method, path, body] = requestFor(name, data, n);
  const url = BASES.length > 1 ? BASES[n % BASES.length] + path.slice(BASE.length) : path;
  const anonymous = ANONYMOUS[name];
  const headers = anonymous
    ? { "X-Forwarded-For": ipFor(1000 + (n % 60000)) }
    : { Cookie: `${COOKIE}=${user.cookie}`, "X-Forwarded-For": user.ip };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers.Origin = ORIGIN;
  }
  const res = http.request(method, url, body || null, { headers, tags: { name } });
  const ok = anonymous ? anonymous.includes(res.status) : res.status >= 200 && res.status < 300;
  check(res, { "2xx": () => ok }, { name });
  if (!ok) statusCount.add(1, { name, status: String(res.status) });
  bodyBytes.add(res.body ? res.body.length : 0, { name });
  const timing = res.headers["Server-Timing"];
  if (timing) {
    const auth = /auth;dur=([\d.]+)/.exec(timing);
    const total = /total;dur=([\d.]+)/.exec(timing);
    if (auth) serverAuth.add(Number(auth[1]), { name });
    if (total) serverTotal.add(Number(total[1]), { name });
    const acquire = /db-acquire;dur=([\d.]+);desc="(\d+)\/(\d+)"/.exec(timing);
    if (acquire) {
      serverDbWait.add(Number(acquire[1]), { name });
      if (Number(acquire[3]) > 0) serverDbOpened.add(Number(acquire[3]), { name });
    }
    // Unified search: each type's time on the server.
    for (const [, type, ms] of timing.matchAll(/search-(\w+);dur=([\d.]+)/g)) {
      serverSearchType.add(Number(ms), { type });
    }
  }
}

export function handleSummary(data) {
  const out = {};
  if (__ENV.SUMMARY) out[__ENV.SUMMARY] = JSON.stringify(data, null, 1);
  const d = data.metrics["http_req_duration{scenario:pms}"];
  const reqs = data.metrics["http_reqs{scenario:pms}"];
  const failed = data.metrics["http_req_failed{scenario:pms}"];
  const line = (label, value) => `${label.padEnd(22)} ${value}\n`;
  out.stdout =
    line("requests", `${reqs.values.count} (${reqs.values.rate.toFixed(1)}/s)`) +
    line("failed rate", `${(failed.values.rate * 100).toFixed(2)}%`) +
    line(
      "latency ms",
      `p50 ${d.values.med.toFixed(1)} p90 ${d.values["p(90)"].toFixed(1)} p95 ${d.values["p(95)"].toFixed(1)} p99 ${d.values["p(99)"].toFixed(1)} max ${d.values.max.toFixed(1)}`,
    ) +
    line(
      "dropped iterations",
      data.metrics.dropped_iterations ? data.metrics.dropped_iterations.values.count : 0,
    );
  return out;
}
