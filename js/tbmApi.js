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
      const destination =
        firstValue(vehicleJourney.DestinationName) || firstValue(vehicleJourney.DirectionName, "?");
      const aimedTime = parseTime(call.AimedArrivalTime);
      const expectedTime = parseTime(call.ExpectedArrivalTime);
      passages.push({
        lineRef,
        lineCode: line ? line.code : lineRef,
        lineName: line ? line.name : "",
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
    return parseStops(payload);
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

  async stopMonitoring(stopRef, limit = 10) {
    const linesByRef = await this._lines();
    const payload = await this._get("stop-monitoring.json", { MonitoringRef: stopRef });
    return parsePassages(payload, linesByRef).slice(0, limit);
  }
}
