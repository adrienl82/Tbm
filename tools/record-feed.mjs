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
// Options:
//   --interval <sec>  seconds between polls (default 20; feed refreshes ~10-30s)
//   --out <dir>       output root (default ./data)
//   --trips           also record the trip-updates feed (per-trip delays)
//   --alerts          also record the service-alerts feed (disruptions)
//   --raw             also keep every raw vehicles protobuf response, gzipped
//   --once            poll a single time, print a summary, exit (smoke test)
//
// Output layout (rotates automatically at midnight, local time):
//   data/2026-09-09/vehicles-2026-09-09.ndjson     one row per new vehicle fix
//   data/2026-09-09/trips-2026-09-09.ndjson         one row per trip when its delay moves (--trips)
//   data/2026-09-09/alerts-2026-09-09.ndjson        one row per alert when it appears/changes (--alerts)
//   data/2026-09-09/raw/153201.pb.gz                (--raw)
//   data/2026-09-09/meta.json                       (run info + counters)
//
// Analyse later with DuckDB (`SELECT ... FROM 'data/2026-09-09/vehicles-*.ndjson'`)
// or pandas (`pd.read_json(path, lines=True)`). Gzip the .ndjson files when a
// day is done (`gzip data/2026-09-09/*.ndjson`) -- DuckDB and pandas both
// read .ndjson.gz directly.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

import { FEED_URL, decodeFeedMessage } from "../js/vehiclePositions.js";
import { isValidCoordinate } from "../js/geoBounds.js";

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

// A trip-update row is re-emitted only when the trip's delay moves by at
// least this many seconds since the last one written for it (same
// change-only principle as the vehicle-fix dedup below).
const TRIP_DELAY_EPSILON_SEC = 30;

// --- CLI args -------------------------------------------------------------

function parseArgs(argv) {
  const opts = { interval: 20, out: "data", raw: false, trips: false, alerts: false, once: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--interval") opts.interval = Number(argv[++i]);
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--raw") opts.raw = true;
    else if (arg === "--trips") opts.trips = true;
    else if (arg === "--alerts") opts.alerts = true;
    else if (arg === "--once") opts.once = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 40).join("\n").replace(/^\/\/ ?/gm, ""));
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
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// --- date-rotated output writers ----------------------------------------

function localDateString(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// One set of append streams per calendar day; when the day rolls over the
// old streams are flushed and closed and a fresh dir is opened.
const writers = {
  date: null,
  dir: null,
  vehicles: null,
  trips: null,
  alerts: null,
};

function rotateTo(date) {
  if (writers.date === date) return;
  closeWriters();
  const dir = path.join(opts.out, date);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.raw) fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  writers.date = date;
  writers.dir = dir;
  writers.vehicles = fs.createWriteStream(path.join(dir, `vehicles-${date}.ndjson`), { flags: "a" });
  if (opts.trips) {
    writers.trips = fs.createWriteStream(path.join(dir, `trips-${date}.ndjson`), { flags: "a" });
  }
  if (opts.alerts) {
    writers.alerts = fs.createWriteStream(path.join(dir, `alerts-${date}.ndjson`), { flags: "a" });
  }
  console.error(`[${new Date().toISOString()}] ecriture dans ${dir}/`);
}

function closeWriters() {
  writers.vehicles?.end();
  writers.trips?.end();
  writers.alerts?.end();
  writers.vehicles = null;
  writers.trips = null;
  writers.alerts = null;
}

// --- dedup: a vehicle's own fix timestamp only moves forward, so emit a row
// only when we see a newer fix than the last one recorded for that vehicle.
// Bounded memory (~one entry per active vehicle), unlike keeping every
// (id, ts) pair seen all day. Vehicles with no timestamp are always emitted.
const lastFixTs = new Map();
// trip_id -> last delay (s) written; alert_id -> hash of last state written.
const lastTripDelay = new Map();
const lastAlertHash = new Map();

const counters = {
  startedAt: new Date().toISOString(),
  polls: 0,
  errors: 0,
  vehicleRowsWritten: 0,
  tripRowsWritten: 0,
  alertRowsWritten: 0,
  lastPollAt: null,
  lastVehicleCount: 0,
};

function writeMeta() {
  if (!writers.dir) return;
  const meta = {
    ...counters,
    feedUrl: FEED_URL,
    intervalSec: opts.interval,
    raw: opts.raw,
    trips: opts.trips,
    alerts: opts.alerts,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(writers.dir, "meta.json"), JSON.stringify(meta, null, 2));
  } catch (err) {
    console.error(`meta.json non ecrit : ${err.message}`);
  }
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

// One row per trip whose delay has moved by >= TRIP_DELAY_EPSILON_SEC since
// the last row written for it (or that we've never seen). `next` is the first
// stop_time_update still in the future -- the trip's imminent prediction.
function tripRows(decoded, recordedAt) {
  const nowSec = Date.parse(recordedAt) / 1000;
  const rows = [];
  for (const entity of decoded?.entity ?? []) {
    const tu = entity.trip_update ?? entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;

    const delay = typeof tu.delay === "number" ? tu.delay : null;
    if (delay !== null) {
      const last = lastTripDelay.get(tripId);
      if (last !== undefined && Math.abs(delay - last) < TRIP_DELAY_EPSILON_SEC) continue;
      lastTripDelay.set(tripId, delay);
    } else if (lastTripDelay.has(tripId)) {
      continue; // no delay now, already have a row for this trip
    } else {
      lastTripDelay.set(tripId, 0);
    }

    const stus = tu.stopTimeUpdate ?? tu.stop_time_update ?? [];
    const next =
      stus.find((s) => (s.arrival?.time ?? s.departure?.time ?? 0) >= nowSec) ?? stus[stus.length - 1] ?? null;
    const nextTime = next ? (next.arrival?.time ?? next.departure?.time ?? null) : null;

    rows.push({
      rt: recordedAt,
      trip: tripId,
      route: tu.trip.routeId != null ? String(tu.trip.routeId) : null,
      dir: typeof tu.trip.directionId === "number" ? tu.trip.directionId : null,
      start_date: tu.trip.startDate ?? null,
      delay_sec: delay,
      next_stop: next?.stopId || null,
      next_stop_seq: typeof next?.stopSequence === "number" ? next.stopSequence : null,
      next_time: nextTime ? new Date(nextTime * 1000).toISOString() : null,
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
  rotateTo(localDateString(now));
  const recordedAt = now.toISOString();

  const bytes = await fetchBytes(FEED_URL);
  if (opts.raw) {
    const stamp = recordedAt.slice(11, 19).replace(/:/g, "");
    fs.writeFileSync(path.join(writers.dir, "raw", `${stamp}.pb.gz`), zlib.gzipSync(bytes));
  }

  const decoded = decodeFeedMessage(bytes, protobuf);
  const rows = vehicleRows(decoded, recordedAt);
  if (rows.length > 0) {
    writers.vehicles.write(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }

  counters.polls += 1;
  counters.lastPollAt = recordedAt;
  counters.lastVehicleCount = (decoded?.entity ?? []).length;
  counters.vehicleRowsWritten += rows.length;

  let tripCount = 0;
  if (opts.trips) {
    try {
      const trips = tripRows(await fetchDecoded(TRIPS_FEED_URL), recordedAt);
      tripCount = trips.length;
      if (trips.length > 0) writers.trips.write(trips.map((r) => JSON.stringify(r)).join("\n") + "\n");
      counters.tripRowsWritten += trips.length;
    } catch (err) {
      console.error(`[${recordedAt}] trips: ${err.message}`);
    }
  }

  if (opts.alerts) {
    try {
      const alerts = alertRows(await fetchDecoded(ALERTS_FEED_URL), recordedAt);
      if (alerts.length > 0) writers.alerts.write(alerts.map((r) => JSON.stringify(r)).join("\n") + "\n");
      counters.alertRowsWritten += alerts.length;
    } catch (err) {
      console.error(`[${recordedAt}] alerts: ${err.message}`);
    }
  }

  return { vehicles: counters.lastVehicleCount, newRows: rows.length, tripRows: tripCount };
}

// --- run loop --------------------------------------------------------

let stopping = false;

async function loop() {
  while (!stopping) {
    const tick = Date.now();
    try {
      const { vehicles, newRows, tripRows: tRows } = await pollOnce();
      if (counters.polls % 10 === 0 || counters.polls === 1) {
        console.error(
          `[${counters.lastPollAt}] poll #${counters.polls} : ${vehicles} vehicules, +${newRows} lignes` +
            (opts.trips ? `, +${tRows} trips` : "") +
            ` (total ${counters.vehicleRowsWritten} veh` +
            (opts.trips ? `, ${counters.tripRowsWritten} trips` : "") +
            (opts.alerts ? `, ${counters.alertRowsWritten} alerts` : "") +
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

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.error(`\n[${new Date().toISOString()}] ${signal} recu, on ferme proprement...`);
  while (shutdownResolvers.length) shutdownResolvers.pop()();
  writeMeta();
  closeWriters();
  // Give the streams a beat to flush their buffers before exit.
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (opts.once) {
  pollOnce()
    .then((r) => {
      writeMeta();
      closeWriters();
      console.error(
        `OK : ${r.vehicles} vehicules dans le flux, ${r.newRows} lignes` +
          (opts.trips ? `, ${r.tripRows} trips` : "") +
          (opts.alerts ? `, ${counters.alertRowsWritten} alerts` : "") +
          ` ecrites dans ${writers.dir}/`,
      );
      setTimeout(() => process.exit(0), 200);
    })
    .catch((err) => {
      console.error(`echec : ${err.message}`);
      process.exit(1);
    });
} else {
  console.error(
    `Enregistrement du flux TBM toutes les ${opts.interval}s -> ${opts.out}/<date>/  (Ctrl+C pour arreter)`,
  );
  loop();
}
