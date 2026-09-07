// Fetches TBM's live GTFS-RT vehicle positions feed for a given line and
// decodes it with protobufjs (loaded globally from a CDN script tag, like
// Leaflet's `L`). This is a different feed than both the SIRI-Lite
// real-time schedules (tbmApi.js) and the static route shapes
// (lineShapes.js): it's the actual bus/tram GPS positions, refreshed by
// TBM roughly every 10-30 seconds.
//
// GTFS_REALTIME_PROTO is a trimmed copy of the public, stable
// gtfs-realtime.proto schema -- only the fields this app reads.

import { isValidCoordinate } from "./geoBounds.js";
import { lineNumericId } from "./lineShapes.js";

const FEED_URL =
  "https://bdx.mecatran.com/utw/ws/gtfsfeed/vehicles/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt";

const GTFS_REALTIME_PROTO = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  repeated FeedEntity entity = 2;
}

message FeedEntity {
  optional VehiclePosition vehicle = 4;
}

message TripDescriptor {
  optional string trip_id = 1;
  optional string route_id = 5;
}

message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
}

message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional float speed = 5;
}

enum VehicleStopStatus {
  INCOMING_AT = 0;
  STOPPED_AT = 1;
  IN_TRANSIT_TO = 2;
}

message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 8;
  optional Position position = 2;
  optional VehicleStopStatus current_status = 4 [default = IN_TRANSIT_TO];
  optional string stop_id = 7;
  optional uint64 timestamp = 5;
}
`;

let feedMessageType = null;

function getFeedMessageType(pbLib) {
  if (!feedMessageType) {
    feedMessageType = pbLib.parse(GTFS_REALTIME_PROTO).root.lookupType("transit_realtime.FeedMessage");
  }
  return feedMessageType;
}

// GTFS-RT's VehicleStopStatus enum (see the embedded schema above): a
// vehicle is only genuinely stationary when it's STOPPED_AT a stop --
// INCOMING_AT and IN_TRANSIT_TO both mean it's still moving.
const STOPPED_AT = 1;

// decoded is the plain object form of a FeedMessage (FeedMessage.toObject()).
// routeId is the bare numeric line id (see lineShapes.js's lineNumericId).
// Vehicles with a missing position or a coordinate outside the sanity
// bounds (GPS glitches routinely report (0, 0) or wildly wrong fixes) are
// dropped rather than shown in the wrong place.
export function parseVehiclePositions(decoded, routeId) {
  const entities = decoded?.entity ?? [];
  const vehicles = [];
  for (const entity of entities) {
    const vehicle = entity.vehicle;
    const position = vehicle?.position;
    if (!vehicle || !position) continue;
    if (String(vehicle.trip?.routeId ?? "") !== String(routeId)) continue;
    if (!isValidCoordinate(position.latitude, position.longitude)) continue;
    vehicles.push({
      id: vehicle.vehicle?.id || vehicle.trip?.tripId || "",
      label: vehicle.vehicle?.label ?? "",
      latitude: position.latitude,
      longitude: position.longitude,
      bearing: typeof position.bearing === "number" ? position.bearing : null,
      speedKmh: typeof position.speed === "number" ? Math.round(position.speed * 3.6) : null,
      stopId: vehicle.stopId || null,
      moving: vehicle.currentStatus !== STOPPED_AT,
      // GTFS-RT timestamps are Unix seconds.
      timestamp: typeof vehicle.timestamp === "number" && vehicle.timestamp > 0 ? new Date(vehicle.timestamp * 1000) : null,
    });
  }
  return vehicles;
}

// route_id (as a string) of every vehicle currently reporting a valid
// position, regardless of line -- lets a caller tell which lines actually
// have service running right now (many, like TBNight or the SCODI school
// routes, only run part of the day) versus just existing in the static
// line list.
export function activeRouteIds(decoded) {
  const entities = decoded?.entity ?? [];
  const ids = new Set();
  for (const entity of entities) {
    const vehicle = entity.vehicle;
    const position = vehicle?.position;
    if (!vehicle || !position) continue;
    if (!isValidCoordinate(position.latitude, position.longitude)) continue;
    const routeId = vehicle.trip?.routeId;
    if (routeId !== undefined && routeId !== null && routeId !== "") ids.add(String(routeId));
  }
  return ids;
}

async function fetchDecodedFeed({ fetchImpl = null, protobufImpl = null } = {}) {
  const fetcher = fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const pbLib = protobufImpl ?? (typeof protobuf !== "undefined" ? protobuf : null);
  if (!fetcher || !pbLib) return null;

  const response = await fetcher(FEED_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en recuperant les positions des vehicules`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const FeedMessage = getFeedMessageType(pbLib);
  // longs: Number -- the timestamp (Unix seconds) is well within safe
  // integer range, and a plain number is simpler to work with than the
  // Long objects protobufjs otherwise produces for uint64 fields.
  return FeedMessage.toObject(FeedMessage.decode(bytes), { defaults: true, longs: Number });
}

export async function fetchVehiclePositions(lineRef, options = {}) {
  const routeId = lineNumericId(lineRef);
  if (!routeId) return [];
  const decoded = await fetchDecodedFeed(options);
  if (!decoded) return [];
  return parseVehiclePositions(decoded, routeId);
}

export async function fetchActiveRouteIds(options = {}) {
  const decoded = await fetchDecodedFeed(options);
  return decoded ? activeRouteIds(decoded) : new Set();
}
