// Client for Bordeaux Metropole's public SIRI-Lite real-time transport feed.
//
// TBM does not expose a plain RSS feed. Real-time bus/tram data is published
// as JSON through the SIRI-Lite web services documented on
// https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite
// using the shared public account key below (no registration needed). The
// API sends permissive CORS headers, so the browser can call it directly
// with no backend in between.

export const BASE_URL = "https://bdx.mecatran.com/utw/ws/siri/2.0/bordeaux";
export const ACCOUNT_KEY = "opendata-bordeaux-metropole-flux-gtfs-rt";

const STOPS_CACHE_TTL_MS = 24 * 3600 * 1000;
const LINES_CACHE_TTL_MS = 24 * 3600 * 1000;

export class TbmApiError extends Error {}

function firstValue(entries, fallback = "") {
  if (!entries || entries.length === 0) return fallback;
  return entries[0].value ?? fallback;
}

function parseTime(value) {
  return value ? new Date(value) : null;
}

export function parseStops(payload) {
  const refs = payload?.Siri?.StopPointsDelivery?.AnnotatedStopPointRef ?? [];
  return refs.map((entry) => ({
    ref: entry.StopPointRef.value,
    name: entry.StopName?.value ?? "?",
    latitude: entry.Location?.latitude ?? 0,
    longitude: entry.Location?.longitude ?? 0,
    lineRefs: (entry.Lines ?? []).map((line) => line.value),
  }));
}

// A named stop (e.g. "Quinconces") is really a cluster of physical stop
// points -- one per platform/direction, sometimes a dozen+ on a big square.
// Group them so the search only shows one row per name, keeping every
// member ref so stopMonitoring() can query all of them and merge the
// results. Points with no line at all are stale/decommissioned SAEIV
// entries; drop them unless they're all a name has.
export function groupStopsByName(stops) {
  const byName = new Map();
  for (const stop of stops) {
    const key = stop.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(stop);
  }

  const grouped = [];
  for (const points of byName.values()) {
    const active = points.filter((point) => point.lineRefs.length > 0);
    const members = (active.length > 0 ? active : points).slice().sort((a, b) => a.ref.localeCompare(b.ref));
    grouped.push({
      ref: members[0].ref,
      name: members[0].name,
      refs: members.map((point) => point.ref),
    });
  }
  return grouped;
}

export function parseLines(payload) {
  const refs = payload?.Siri?.LinesDelivery?.AnnotatedLineRef ?? [];
  const byRef = new Map();
  for (const entry of refs) {
    const ref = entry.LineRef.value;
    byRef.set(ref, {
      ref,
      code: entry.LineCode?.value ?? "",
      name: firstValue(entry.LineName),
    });
  }
  return byRef;
}

export function parsePassages(payload, linesByRef) {
  const deliveries = payload?.Siri?.ServiceDelivery?.StopMonitoringDelivery ?? [];
  if (deliveries.length > 0 && deliveries[0].Status === false) {
    throw new TbmApiError(deliveries[0].ErrorCondition ?? "reponse invalide de l'API TBM");
  }

  const passages = [];
  for (const delivery of deliveries) {
    for (const visit of delivery.MonitoredStopVisit ?? []) {
      const vehicleJourney = visit.MonitoredVehicleJourney;
      const call = vehicleJourney.MonitoredCall ?? {};
      const lineRef = vehicleJourney.LineRef.value;
      const line = linesByRef.get(lineRef);
      const direction = firstValue(vehicleJourney.DirectionName) || firstValue(vehicleJourney.DestinationName, "?");
      const destination = firstValue(vehicleJourney.DestinationName) || direction;
      const aimedTime = parseTime(call.AimedArrivalTime);
      const expectedTime = parseTime(call.ExpectedArrivalTime);
      passages.push({
        lineRef,
        lineCode: line ? line.code : lineRef,
        lineName: line ? line.name : "",
        direction,
        destination,
        aimedTime,
        expectedTime,
        bestTime: expectedTime || aimedTime,
        delayMinutes:
          aimedTime && expectedTime ? Math.round((expectedTime - aimedTime) / 60000) : null,
      });
    }
  }

  passages.sort((a, b) => (a.bestTime?.getTime() ?? Infinity) - (b.bestTime?.getTime() ?? Infinity));
  return passages;
}

export class TbmClient {
  constructor({ storage = null, fetchImpl = null } = {}) {
    this.storage = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    this.fetchImpl = fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    this._linesByRef = null;
  }

  async _get(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set("AccountKey", ACCOUNT_KEY);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new TbmApiError(`HTTP ${response.status} en appelant ${endpoint}`);
    }
    return response.json();
  }

  async _cachedJson(cacheKey, ttlMs, fetchFn) {
    if (this.storage) {
      const raw = this.storage.getItem(cacheKey);
      if (raw) {
        try {
          const { timestamp, data } = JSON.parse(raw);
          if (Date.now() - timestamp < ttlMs) return data;
        } catch {
          // corrupted cache entry: fall through and refetch
        }
      }
    }
    const data = await fetchFn();
    this.storage?.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
    return data;
  }

  async listStops() {
    const payload = await this._cachedJson("tbm.cache.stops", STOPS_CACHE_TTL_MS, () =>
      this._get("stoppoints-discovery.json"),
    );
    return groupStopsByName(parseStops(payload));
  }

  async searchStops(query, limit = 30) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const stops = await this.listStops();
    return stops
      .filter((stop) => stop.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async _lines() {
    if (this._linesByRef) return this._linesByRef;
    const payload = await this._cachedJson("tbm.cache.lines", LINES_CACHE_TTL_MS, () =>
      this._get("lines-discovery.json"),
    );
    this._linesByRef = parseLines(payload);
    return this._linesByRef;
  }

  // stopRefs is either a single physical stop ref or an array of them (a
  // named stop's platforms, from a grouped Stop's `refs`). Results from all
  // refs are merged into one time-sorted list; a failure on some refs
  // doesn't hide the ones that answered.
  async stopMonitoring(stopRefs, limit = 10) {
    const refs = Array.isArray(stopRefs) ? stopRefs : [stopRefs];
    const linesByRef = await this._lines();
    const settled = await Promise.allSettled(
      refs.map((ref) => this._get("stop-monitoring.json", { MonitoringRef: ref })),
    );

    const passages = [];
    let lastError = null;
    for (const result of settled) {
      if (result.status !== "fulfilled") {
        lastError = result.reason;
        continue;
      }
      try {
        passages.push(...parsePassages(result.value, linesByRef));
      } catch (err) {
        lastError = err;
      }
    }
    if (passages.length === 0 && lastError) throw lastError;

    passages.sort((a, b) => (a.bestTime?.getTime() ?? Infinity) - (b.bestTime?.getTime() ?? Infinity));
    return passages.slice(0, limit);
  }
}
