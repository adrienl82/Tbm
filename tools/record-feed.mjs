// Records TBM's live GTFS-RT vehicle-positions feed to disk over a long
// period (a full service day, say) so the trips can be analysed offline
// afterwards -- trajectories, speeds, dwell times, per-line service by hour,
// bunching, etc.
//
// The browser app can't do this (a tab left open for 18h, a 5 MB
// localStorage cap); a small Node poller can. One request to the feed
// returns every vehicle on the whole network, so this polls that single URL
// on an interval and appends one NDJSON row per *new* vehicle fix.
//
//   npm install                # once, pulls protobufjs
//   node tools/record-feed.mjs # Ctrl+C to stop cleanly
//
// Output is split by *service session* (see tools/lib/serviceSession.mjs), not
// by calendar day: a session opens when vehicles start circulating and closes
// at the early-morning cut time or when service ends. A closed session dir
// gets a DONE sentinel -- that's the analyzer's trigger.
//
// Options:
//   --interval <sec>       seconds between polls (default 20; feed refreshes ~10-30s)
//   --out <dir>            output root (default ./data)
//   --trips                also record the trip-updates feed (per-trip delays)
//   --alerts               also record the service-alerts feed (disruptions)
//   --raw                  also keep every raw vehicles protobuf response, gzipped
//   --session-cut <HH:MM>  daily session cut time, local (default 04:00)
//   --session-gap-min <n>  minutes with no vehicle before a session ends (default 45)
//   --once                 poll a single time, print a summary, exit (smoke test)
//
// Output layout:
//   data/state.json                          current session pointer + last cut date
//   data/session-20260909T0412/
//     vehicles.ndjson                         one row per new vehicle fix
//     trips.ndjson                            one row per trip when its delay moves (--trips)
//     alerts.ndjson                           one row per alert when it appears/changes (--alerts)
//     raw/153201.pb.gz                        (--raw)
//     meta.json                               run info + counters (+ end/closed_by once closed)
//     DONE                                    written when the session closes
//
// Session ids are compact UTC (session open minute). Analyse later with DuckDB
// (`SELECT ... FROM 'data/session-*/vehicles.ndjson'`) or pandas; gzip a closed
// session's .ndjson files (DuckDB and pandas read .ndjson.gz directly).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

import { FEED_URL, decodeFeedMessage } from "../js/vehiclePositions.js";
import { isValidCoordinate } from "../js/geoBounds.js";
import { initialState, step } from "./lib/serviceSession.mjs";

const require = createRequire(import.meta.url);
let protobuf;
try {
  protobuf = require("protobufjs");
} catch {
  console.error("protobufjs introuvable -- lance `npm install` a la racine du projet d'abord.");
  process.exit(1);
}

const ALERTS_FEED_URL =
  "https://bdx.mecatran.com/utw/ws/gtfsfeed/alerts/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt";
const TRIPS_FEED_URL =
  "https://bdx.mecatran.com/utw/ws/gtfsfeed/realtime/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt";

// A trip-update row is re-emitted when its imminent stop's own predicted
// delay moves by at least this many seconds since the last one written for
// it (same change-only principle as the vehicle-fix dedup below). TBM's
// trip-level delay field is not useful for this -- it reports ~0 for every
// trip regardless of how late it actually runs.
const TRIP_DELAY_EPSILON_SEC = 30;

// --- CLI args -------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    interval: 20,
    out: "data",
    raw: false,
    trips: false,
    alerts: false,
    once: false,
    sessionCut: "04:00",
    sessionGapMin: 45,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--interval") opts.interval = Number(argv[++i]);
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--raw") opts.raw = true;
    else if (arg === "--trips") opts.trips = true;
    else if (arg === "--alerts") opts.alerts = true;
    else if (arg === "--session-cut") opts.sessionCut = argv[++i];
    else if (arg === "--session-gap-min") opts.sessionGapMin = Number(argv[++i]);
    else if (arg === "--once") opts.once = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 46).join("\n").replace(/^\/\/ ?/gm, ""));
      process.exit(0);
    } else {
      console.error(`option inconnue : ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(opts.interval) || opts.interval < 1) {
    console.error("--interval doit etre un nombre de secondes >= 1");
    process.exit(1);
  }
  if (!/^\d{2}:\d{2}$/.test(opts.sessionCut)) {
    console.error("--session-cut doit etre au format HH:MM");
    process.exit(1);
  }
  if (!Number.isFinite(opts.sessionGapMin) || opts.sessionGapMin < 1) {
    console.error("--session-gap-min doit etre un nombre de minutes >= 1");
    process.exit(1);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// --- session state (persisted so a restart resumes the running session) ---

function localParts(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    hm: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

const STATE_PATH = path.join(opts.out, "state.json");
let sessionState = initialState();

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (raw && typeof raw === "object") {
      sessionState = { session: raw.session ?? null, lastCutDate: raw.lastCutDate ?? null };
    }
  } catch {
    /* no state file yet -- first run */
  }
}

function saveState() {
  try {
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(sessionState));
  } catch (err) {
    console.error(`state.json non ecrit : ${err.message}`);
  }
}

// --- per-session output streams --------------------------------------

const writers = { id: null, dir: null, startedAt: null, vehicles: null, trips: null, alerts: null };

// resume: true when this (re)opens a session that was already running before
// a restart (see resumeOrStart), as opposed to a genuinely new one starting.
// Counters then pick up from the session's last flushed meta.json instead of
// resetting to zero -- otherwise a mid-session restart made the final
// meta.json under-report the true session totals (only the post-restart
// segment), even though the ndjson files themselves were never missing data.
function openSession(id, startedAtISO, { resume = false } = {}) {
  const dir = path.join(opts.out, `session-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.raw) fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  writers.id = id;
  writers.dir = dir;
  writers.startedAt = startedAtISO;
  writers.vehicles = fs.createWriteStream(path.join(dir, "vehicles.ndjson"), { flags: "a" });
  if (opts.trips) writers.trips = fs.createWriteStream(path.join(dir, "trips.ndjson"), { flags: "a" });
  if (opts.alerts) writers.alerts = fs.createWriteStream(path.join(dir, "alerts.ndjson"), { flags: "a" });
  // Each session file is self-contained: drop the in-memory dedup so the
  // first poll of the session writes a full snapshot, then deltas.
  lastFixTs.clear();
  lastTripState.clear();
  lastAlertHash.clear();
  sessionCounters = resume ? readPriorCounters(dir) : { polls: 0, vehicleRows: 0, tripRows: 0, alertRows: 0 };
}

function readPriorCounters(dir) {
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
    return {
      polls: prior.polls ?? 0,
      vehicleRows: prior.vehicleRowsWritten ?? 0,
      tripRows: prior.tripRowsWritten ?? 0,
      alertRows: prior.alertRowsWritten ?? 0,
    };
  } catch {
    return { polls: 0, vehicleRows: 0, tripRows: 0, alertRows: 0 }; // no meta.json yet -- nothing to recover
  }
}

function endStreams() {
  writers.vehicles?.end();
  writers.trips?.end();
  writers.alerts?.end();
  writers.vehicles = writers.trips = writers.alerts = null;
}

// Finalize the open session: meta.json (with end/closed_by) + a DONE
// sentinel the analyzer watches for.
function closeSession(reason, endedAtISO) {
  if (!writers.dir) return;
  const dir = writers.dir;
  const id = writers.id;
  writeMeta({ end: endedAtISO, closed_by: reason });
  endStreams();
  try {
    fs.writeFileSync(path.join(dir, "DONE"), `${endedAtISO} ${reason}\n`);
  } catch (err) {
    console.error(`DONE non ecrit : ${err.message}`);
  }
  console.error(`[${endedAtISO}] session ${id} fermee (${reason})`);
  writers.id = writers.dir = writers.startedAt = null;
}

// --- dedup: a vehicle's own fix timestamp only moves forward, so emit a row
// only when we see a newer fix than the last one recorded for that vehicle.
// Bounded memory (~one entry per active vehicle). Cleared at each session
// open (see openSession). Vehicles with no timestamp are always emitted.
const lastFixTs = new Map();
// trip_id -> { stop, delay } last written (see tripRows); alert_id -> hash of
// last state written.
const lastTripState = new Map();
const lastAlertHash = new Map();

const counters = {
  startedAt: new Date().toISOString(), // process start (not session start)
  polls: 0,
  errors: 0,
  lastPollAt: null,
  lastVehicleCount: 0,
};
// reset per session in openSession
let sessionCounters = { polls: 0, vehicleRows: 0, tripRows: 0, alertRows: 0 };

function writeMeta(extra = {}) {
  if (!writers.dir) return;
  const meta = {
    session: writers.id,
    start: writers.startedAt,
    polls: sessionCounters.polls,
    vehicleRowsWritten: sessionCounters.vehicleRows,
    tripRowsWritten: sessionCounters.tripRows,
    alertRowsWritten: sessionCounters.alertRows,
    processErrors: counters.errors,
    lastPollAt: counters.lastPollAt,
    lastVehicleCount: counters.lastVehicleCount,
    feedUrl: FEED_URL,
    intervalSec: opts.interval,
    sessionCut: opts.sessionCut,
    sessionGapMin: opts.sessionGapMin,
    raw: opts.raw,
    trips: opts.trips,
    alerts: opts.alerts,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  try {
    fs.writeFileSync(path.join(writers.dir, "meta.json"), JSON.stringify(meta, null, 2));
  } catch (err) {
    console.error(`meta.json non ecrit : ${err.message}`);
  }
}

// vehicles genuinely circulating right now (valid position) -- drives the
// session state machine; independent of the write-time dedup.
function countLive(decoded) {
  let n = 0;
  for (const entity of decoded?.entity ?? []) {
    const pos = entity.vehicle?.position;
    if (pos && isValidCoordinate(pos.latitude, pos.longitude)) n += 1;
  }
  return n;
}

// --- one poll ----------------------------------------------------------

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// GTFS-RT VehicleStopStatus / a vehicle's raw fields, flattened for
// archival. Keys are short to keep the file small over millions of rows.
function vehicleRows(decoded, recordedAt) {
  const rows = [];
  for (const entity of decoded?.entity ?? []) {
    const v = entity.vehicle;
    const pos = v?.position;
    if (!v || !pos) continue;
    if (!isValidCoordinate(pos.latitude, pos.longitude)) continue;

    const id = v.vehicle?.id || v.trip?.tripId || "";
    const ft = typeof v.timestamp === "number" && v.timestamp > 0 ? v.timestamp : null;
    if (ft !== null && id) {
      if (lastFixTs.get(id) >= ft) continue; // already recorded this fix
      lastFixTs.set(id, ft);
    }

    rows.push({
      rt: recordedAt, // when this poller fetched the feed
      ft: ft === null ? null : new Date(ft * 1000).toISOString(), // vehicle's GPS fix time
      id,
      label: v.vehicle?.label ?? "",
      trip: v.trip?.tripId ?? null,
      route: v.trip?.routeId != null ? String(v.trip.routeId) : null,
      dir: typeof v.trip?.directionId === "number" ? v.trip.directionId : null,
      lat: pos.latitude,
      lon: pos.longitude,
      brg: typeof pos.bearing === "number" ? pos.bearing : null,
      spd: typeof pos.speed === "number" ? pos.speed : null, // m/s, raw from feed
      stop: v.stopId || null,
      st: typeof v.currentStatus === "number" ? v.currentStatus : null, // 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO
    });
  }
  return rows;
}

// One row per trip whenever its imminent stop changes (it passed the
// previous one) or that stop's own predicted delay moves by
// >= TRIP_DELAY_EPSILON_SEC. `next` is the first stop_time_update still in
// the future -- the trip's imminent prediction; next_delay_sec is its own
// arrival/departure delay, which is what actually varies (unlike the
// trip-level `delay` field, kept below as delay_sec for completeness but
// observed to sit at 0 for essentially every TBM trip).
function tripRows(decoded, recordedAt) {
  const nowSec = Date.parse(recordedAt) / 1000;
  const rows = [];
  for (const entity of decoded?.entity ?? []) {
    const tu = entity.trip_update ?? entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;

    const stus = tu.stopTimeUpdate ?? tu.stop_time_update ?? [];
    const next =
      stus.find((s) => (s.arrival?.time ?? s.departure?.time ?? 0) >= nowSec) ?? stus[stus.length - 1] ?? null;
    const nextStopId = next?.stopId || null;
    const nextDelay =
      typeof next?.arrival?.delay === "number"
        ? next.arrival.delay
        : typeof next?.departure?.delay === "number"
          ? next.departure.delay
          : null;

    const last = lastTripState.get(tripId);
    const stopChanged = !last || last.stop !== nextStopId;
    const delayChanged = nextDelay !== null && (last?.delay == null || Math.abs(nextDelay - last.delay) >= TRIP_DELAY_EPSILON_SEC);
    if (!stopChanged && !delayChanged) continue;
    lastTripState.set(tripId, { stop: nextStopId, delay: nextDelay });

    const nextTime = next ? (next.arrival?.time ?? next.departure?.time ?? null) : null;

    rows.push({
      rt: recordedAt,
      trip: tripId,
      route: tu.trip.routeId != null ? String(tu.trip.routeId) : null,
      dir: typeof tu.trip.directionId === "number" ? tu.trip.directionId : null,
      start_date: tu.trip.startDate ?? null,
      delay_sec: typeof tu.delay === "number" ? tu.delay : null, // trip-level; usually 0, see above
      next_stop: nextStopId,
      next_stop_seq: typeof next?.stopSequence === "number" ? next.stopSequence : null,
      next_time: nextTime ? new Date(nextTime * 1000).toISOString() : null,
      next_delay_sec: nextDelay,
      sched_rel: typeof tu.trip.scheduleRelationship === "number" ? tu.trip.scheduleRelationship : null,
    });
  }
  return rows;
}

function firstText(translated) {
  const t = translated?.translation ?? [];
  return (t.find((x) => x.language === "fr") ?? t[0])?.text ?? null;
}

// One row per alert on first sighting and whenever its content changes.
function alertRows(decoded, recordedAt) {
  const rows = [];
  for (const entity of decoded?.entity ?? []) {
    const a = entity.alert;
    if (!a) continue;
    const id = entity.id || "";

    const row = {
      rt: recordedAt,
      alert_id: id,
      cause: typeof a.cause === "number" ? a.cause : null,
      effect: typeof a.effect === "number" ? a.effect : null,
      header: firstText(a.headerText),
      description: firstText(a.descriptionText),
      active: (a.activePeriod ?? []).map((p) => ({
        start: p.start ? new Date(p.start * 1000).toISOString() : null,
        end: p.end ? new Date(p.end * 1000).toISOString() : null,
      })),
      informed: (a.informedEntity ?? []).map((e) => ({
        route: e.routeId || null,
        stop: e.stopId || null,
        dir: typeof e.directionId === "number" ? e.directionId : null,
        trip: e.trip?.tripId || null,
      })),
    };

    const hash = JSON.stringify([row.cause, row.effect, row.header, row.description, row.active, row.informed]);
    if (lastAlertHash.get(id) === hash) continue;
    lastAlertHash.set(id, hash);
    rows.push(row);
  }
  return rows;
}

async function fetchDecoded(url) {
  return decodeFeedMessage(await fetchBytes(url), protobuf);
}

async function pollOnce() {
  const now = new Date();
  const recordedAt = now.toISOString();
  const { date: localDate, hm: localHM } = localParts(now);

  const bytes = await fetchBytes(FEED_URL);
  const decoded = decodeFeedMessage(bytes, protobuf);
  const live = countLive(decoded);

  // Advance the service-session machine before writing anything: a boundary
  // this poll must land in the right session dir.
  const { state, events } = step(sessionState, {
    now,
    liveVehicleCount: live,
    localDate,
    localHM,
    cutLocal: opts.sessionCut,
    gapMin: opts.sessionGapMin,
  });
  for (const ev of events) {
    if (ev.type === "close") closeSession(ev.reason, ev.at.toISOString());
    else if (ev.type === "open") {
      openSession(ev.sessionId, ev.at.toISOString());
      console.error(`[${ev.at.toISOString()}] session ${ev.sessionId} ouverte -> ${writers.dir}/`);
    }
  }
  sessionState = state;
  saveState();

  counters.polls += 1;
  counters.lastPollAt = recordedAt;
  counters.lastVehicleCount = live;

  if (!writers.dir) {
    // Between sessions (early-morning lull): nothing to record.
    return { live, newRows: 0, tripRows: 0 };
  }
  sessionCounters.polls += 1;

  if (opts.raw) {
    const stamp = recordedAt.slice(11, 19).replace(/:/g, "");
    fs.writeFileSync(path.join(writers.dir, "raw", `${stamp}.pb.gz`), zlib.gzipSync(bytes));
  }

  const rows = vehicleRows(decoded, recordedAt);
  if (rows.length > 0) writers.vehicles.write(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  sessionCounters.vehicleRows += rows.length;

  let tripCount = 0;
  if (opts.trips) {
    try {
      const trips = tripRows(await fetchDecoded(TRIPS_FEED_URL), recordedAt);
      tripCount = trips.length;
      if (trips.length > 0) writers.trips.write(trips.map((r) => JSON.stringify(r)).join("\n") + "\n");
      sessionCounters.tripRows += trips.length;
    } catch (err) {
      console.error(`[${recordedAt}] trips: ${err.message}`);
    }
  }

  if (opts.alerts) {
    try {
      const alerts = alertRows(await fetchDecoded(ALERTS_FEED_URL), recordedAt);
      if (alerts.length > 0) writers.alerts.write(alerts.map((r) => JSON.stringify(r)).join("\n") + "\n");
      sessionCounters.alertRows += alerts.length;
    } catch (err) {
      console.error(`[${recordedAt}] alerts: ${err.message}`);
    }
  }

  return { live, newRows: rows.length, tripRows: tripCount };
}

// --- run loop --------------------------------------------------------

let stopping = false;

async function loop() {
  while (!stopping) {
    const tick = Date.now();
    try {
      const { live, newRows, tripRows: tRows } = await pollOnce();
      if (counters.polls % 10 === 0 || counters.polls === 1) {
        const where = writers.id ? `session ${writers.id}` : "hors session";
        console.error(
          `[${counters.lastPollAt}] poll #${counters.polls} (${where}) : ${live} vehicules, +${newRows} lignes` +
            (opts.trips ? `, +${tRows} trips` : "") +
            ` (session ${sessionCounters.vehicleRows} veh` +
            (opts.trips ? `, ${sessionCounters.tripRows} trips` : "") +
            (opts.alerts ? `, ${sessionCounters.alertRows} alerts` : "") +
            `, ${counters.errors} erreurs)`,
        );
      }
      if (counters.polls % 30 === 0) writeMeta();
    } catch (err) {
      counters.errors += 1;
      console.error(`[${new Date().toISOString()}] erreur poll : ${err.message}`);
    }
    if (stopping) break;
    const waitMs = Math.max(0, opts.interval * 1000 - (Date.now() - tick));
    await new Promise((resolve) => {
      const t = setTimeout(resolve, waitMs);
      shutdownResolvers.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

const shutdownResolvers = [];

// Stopping the recorder does NOT close the running session -- it's still the
// same operating day, and the next start resumes it (see resumeOrStart). We
// just flush an interim meta.json + state.json.
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.error(`\n[${new Date().toISOString()}] ${signal} recu, on ferme proprement...`);
  while (shutdownResolvers.length) shutdownResolvers.pop()();
  writeMeta();
  endStreams();
  saveState();
  // Give the streams a beat to flush their buffers before exit.
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// On startup, if state.json says a session was running, reopen its streams so
// this run appends to it. The first poll's step() will cleanly close it
// (gap/cut) and open a fresh one if it has since gone stale.
function resumeOrStart() {
  loadState();
  if (sessionState.session) {
    const { id, startedAt } = sessionState.session;
    openSession(id, startedAt, { resume: true });
    console.error(`[${new Date().toISOString()}] reprise de la session ${id}`);
  }
}

if (opts.once) {
  resumeOrStart();
  pollOnce()
    .then((r) => {
      writeMeta();
      endStreams();
      saveState();
      console.error(
        `OK : ${r.live} vehicules, ${r.newRows} lignes` +
          (opts.trips ? `, ${r.tripRows} trips` : "") +
          (opts.alerts ? `, ${sessionCounters.alertRows} alerts` : "") +
          (writers.dir ? ` -> ${writers.dir}/` : " (hors session, rien ecrit)"),
      );
      setTimeout(() => process.exit(0), 200);
    })
    .catch((err) => {
      console.error(`echec : ${err.message}`);
      process.exit(1);
    });
} else {
  console.error(
    `Enregistrement du flux TBM toutes les ${opts.interval}s -> ${opts.out}/session-*/  ` +
      `(coupe ${opts.sessionCut}, gap ${opts.sessionGapMin}min, Ctrl+C pour arreter)`,
  );
  resumeOrStart();
  loop();
}
