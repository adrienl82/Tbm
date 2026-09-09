// Reads TBM's live GTFS-RT trip-updates feed for one trip's upcoming stops
// and their predicted arrival times -- the data behind a followed vehicle's
// "next stops" panel (see app.js openVehicleDetail).
//
// This is a third GTFS-RT feed alongside vehicle positions (vehiclePositions.js)
// and service alerts: same protobuf schema (GTFS_REALTIME_PROTO there already
// defines TripUpdate), decoded the same way.

import { decodeFeedMessage } from "./vehiclePositions.js";

export const TRIP_UPDATES_URL =
  "https://bdx.mecatran.com/utw/ws/gtfsfeed/realtime/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt";

// From a decoded FeedMessage, the still-upcoming stops of trip `tripId`:
//   { tripId, routeId, delaySec, stops: [{ stopId, sequence, arrival, departure }] }
// arrival/departure are Date or null. Stops whose predicted time is already
// well in the past (relative to `now`) are dropped, so what's left is
// genuinely "next". Returns null when the feed carries no update for that
// trip (it finished, hasn't started, or was cancelled).
export function parseTripStops(decoded, tripId, now = new Date()) {
  if (!tripId) return null;
  const cutoff = now.getTime() - 60_000; // 1 min grace for a stop just served
  for (const entity of decoded?.entity ?? []) {
    const tu = entity.tripUpdate ?? entity.trip_update;
    if (!tu || (tu.trip?.tripId ?? null) !== tripId) continue;

    const stops = [];
    for (const s of tu.stopTimeUpdate ?? tu.stop_time_update ?? []) {
      const arrival = s.arrival?.time ? new Date(s.arrival.time * 1000) : null;
      const departure = s.departure?.time ? new Date(s.departure.time * 1000) : null;
      const when = arrival ?? departure;
      if (when && when.getTime() < cutoff) continue;
      stops.push({
        stopId: s.stopId || null,
        sequence: typeof s.stopSequence === "number" ? s.stopSequence : null,
        arrival,
        departure,
      });
    }
    return {
      tripId,
      routeId: tu.trip.routeId != null ? String(tu.trip.routeId) : null,
      delaySec: typeof tu.delay === "number" ? tu.delay : null,
      stops,
    };
  }
  return null;
}

// The trip-updates feed is one ~2 MB response covering every trip, so a
// short shared cache lets several lookups (a refresh cycle, reopening the
// panel) reuse one fetch.
let feedCache = { at: 0, decoded: null };
export const TRIP_UPDATES_CACHE_MS = 15000;

export function _resetTripUpdatesCache() {
  feedCache = { at: 0, decoded: null };
}

export async function fetchTripStops(tripId, options = {}) {
  const { fetchImpl = null, protobufImpl = null, now = new Date() } = options;
  if (!tripId) return null;
  const fetcher = fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const pbLib = protobufImpl ?? (typeof protobuf !== "undefined" ? protobuf : null);
  if (!fetcher || !pbLib) return null;

  if (!feedCache.decoded || Date.now() - feedCache.at > TRIP_UPDATES_CACHE_MS) {
    const response = await fetcher(TRIP_UPDATES_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} en recuperant les prochains passages`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    feedCache = { at: Date.now(), decoded: decodeFeedMessage(bytes, pbLib) };
  }
  return parseTripStops(feedCache.decoded, tripId, now);
}
