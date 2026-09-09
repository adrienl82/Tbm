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
//   --raw             also keep every raw protobuf response, gzipped
//   --alerts          also record the disruptions feed (general messages)
//   --once            poll a single time, print a summary, exit (smoke test)
//
// Output layout (rotates automatically at midnight, local time):
//   data/2026-09-09/vehicles-2026-09-09.ndjson
//   data/2026-09-09/alerts-2026-09-09.ndjson        (--alerts)
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

// --- CLI args -------------------------------------------------------------

function parseArgs(argv) {
  const opts = { interval: 20, out: "data", raw: false, alerts: false, once: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--interval") opts.interval = Number(argv[++i]);
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--raw") opts.raw = true;
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
  if (opts.alerts) {
    writers.alerts = fs.createWriteStream(path.join(dir, `alerts-${date}.ndjson`), { flags: "a" });
  }
  console.error(`[${new Date().toISOString()}] ecriture dans ${dir}/`);
}

function closeWriters() {
  writers.vehicles?.end();
  writers.alerts?.end();
  writers.vehicles = null;
  writers.alerts = null;
}

// --- dedup: a vehicle's own fix timestamp only moves forward, so emit a row
// only when we see a newer fix than the last one recorded for that vehicle.
// Bounded memory (~one entry per active vehicle), unlike keeping every
// (id, ts) pair seen all day. Vehicles with no timestamp are always emitted.
const lastFixTs = new Map();

const counters = {
  startedAt: new Date().toISOString(),
  polls: 0,
  errors: 0,
  vehicleRowsWritten: 0,
  alertPollsWritten: 0,
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

  if (opts.alerts) {
    try {
      const alertBytes = await fetchBytes(ALERTS_FEED_URL);
      const alertDecoded = decodeFeedMessage(alertBytes, protobuf);
      writers.alerts.write(JSON.stringify({ rt: recordedAt, feed: alertDecoded }) + "\n");
      counters.alertPollsWritten += 1;
    } catch (err) {
      console.error(`[${recordedAt}] alerts: ${err.message}`);
    }
  }

  return { vehicles: counters.lastVehicleCount, newRows: rows.length };
}

// --- run loop --------------------------------------------------------

let stopping = false;

async function loop() {
  while (!stopping) {
    const tick = Date.now();
    try {
      const { vehicles, newRows } = await pollOnce();
      if (counters.polls % 10 === 0 || counters.polls === 1) {
        console.error(
          `[${counters.lastPollAt}] poll #${counters.polls} : ${vehicles} vehicules, +${newRows} lignes ` +
            `(total ${counters.vehicleRowsWritten}, ${counters.errors} erreurs)`,
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
      console.error(`OK : ${r.vehicles} vehicules dans le flux, ${r.newRows} lignes ecrites dans ${writers.dir}/`);
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
