// Client-side dead-reckoning for live vehicle markers. TBM's GTFS-RT feed
// only refreshes every ~30s (REFRESH_INTERVAL_MS in app.js); without this, a
// marker sits frozen at its last GPS fix for that whole window, which reads
// as stale rather than "live". Between refreshes, this extrapolates a
// vehicle's current position from its last known fix using its own reported
// speed and bearing -- following the line's actual route shape when one is
// available, rather than cutting corners in a straight line.

import { distanceMeters } from "./geoBounds.js";

const EARTH_RADIUS_M = 6371000;

// Destination point given a start point, bearing (degrees from true north)
// and distance (meters), using the standard great-circle formula. Used as
// the fallback when no trustworthy route shape is available to follow.
export function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const angDist = distanceM / EARTH_RADIUS_M;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lat2 * 180) / Math.PI, (((lon2 * 180) / Math.PI + 540) % 360) - 180];
}

// Initial bearing (degrees from true north) from a to b.
export function bearingBetween([lat1, lon1], [lat2, lon2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Smallest signed difference between two bearings, in [0, 180].
export function angleBetweenBearings(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Distance (meters) to the closest of stopPoints that's actually ahead of a
// vehicle heading in bearingDeg -- within maxAngleDeg of straight ahead.
// Null if none qualify. Using the plain nearest stop in any direction was
// wrong: a vehicle that just left a stop has that same stop right behind
// it, which isn't a risk of being overshot and shouldn't cap its travel at
// all -- only a stop actually ahead is.
export function distanceToStopAhead(point, bearingDeg, stopPoints, maxAngleDeg = 90) {
  if (!point || bearingDeg === null || !stopPoints || stopPoints.length === 0) return null;
  let best = null;
  for (const stop of stopPoints) {
    const d = distanceMeters(point, stop);
    if (d === 0) continue;
    if (angleBetweenBearings(bearingDeg, bearingBetween(point, stop)) > maxAngleDeg) continue;
    if (best === null || d < best) best = d;
  }
  return best;
}

// Closest point to `point` on the segment a-b, as a fraction t (0-1) along
// it. Segments in a route shape are short enough that plain linear
// interpolation in lat/lon (rather than projecting through a local planar
// approximation) is accurate enough for this purpose.
function closestFractionOnSegment(point, a, b) {
  const [px, py] = [point[1], point[0]];
  const [ax, ay] = [a[1], a[0]];
  const [bx, by] = [b[1], b[0]];
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return 0;
  const t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  return Math.max(0, Math.min(1, t));
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Projects point onto polyline (an array of [lat, lon]), returning the
// closest point on it, the vehicle's distance from that point (meters), the
// cumulative distance along the polyline to reach it, the polyline's own
// heading at that spot, and the polyline's total length. Returns null for a
// degenerate polyline (fewer than two points).
export function projectOntoPolyline(point, polyline) {
  if (!polyline || polyline.length < 2) return null;
  let best = null;
  let cumulative = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segmentLength = distanceMeters(a, b);
    const t = closestFractionOnSegment(point, a, b);
    const projected = lerp(a, b, t);
    const distanceFromPolyline = distanceMeters(point, projected);
    if (!best || distanceFromPolyline < best.distanceFromPolyline) {
      best = {
        point: projected,
        distanceAlong: cumulative + t * segmentLength,
        distanceFromPolyline,
        bearing: bearingBetween(a, b),
      };
    }
    cumulative += segmentLength;
  }
  return { ...best, totalLength: cumulative };
}

// The point on polyline at cumulative distanceAlong meters from its start,
// clamped to the polyline's own extent.
export function pointAtDistanceAlong(polyline, distanceAlong) {
  if (!polyline || polyline.length === 0) return null;
  if (distanceAlong <= 0) return polyline[0];
  let cumulative = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segmentLength = distanceMeters(a, b);
    if (distanceAlong <= cumulative + segmentLength) {
      const t = segmentLength === 0 ? 0 : (distanceAlong - cumulative) / segmentLength;
      return lerp(a, b, t);
    }
    cumulative += segmentLength;
  }
  return polyline[polyline.length - 1];
}

// Of several candidate polylines (a line's route shape is often more than
// one -- aller/retour run on separate tracks, sometimes split into several
// pieces), the one point actually sits closest to. Returns the same shape
// projectOntoPolyline does, or null if none are usable.
function closestProjection(point, polylines) {
  let best = null;
  for (const polyline of polylines ?? []) {
    const projection = projectOntoPolyline(point, polyline);
    if (projection && (!best || projection.distanceFromPolyline < best.projection.distanceFromPolyline)) {
      best = { polyline, projection };
    }
  }
  return best;
}

// Maps a naive constant-speed travel distance to what to actually display
// when maxDistance meters ahead is where the vehicle must stop (a stop it's
// approaching). Below (maxDistance - brakeZoneM), it's a plain cruise: the
// two distances match. Past that point it eases off exponentially, so the
// displayed distance closes in on maxDistance asymptotically -- decelerating
// smoothly rather than travelling at a constant speed and then freezing dead
// the instant the old hard cap was reached.
export function decelerateTowardStop(rawDistance, maxDistance, brakeZoneM = 30) {
  if (maxDistance <= 0) return 0;
  const zone = Math.min(brakeZoneM, maxDistance);
  const brakeStart = maxDistance - zone;
  if (rawDistance <= brakeStart) return rawDistance;
  if (zone === 0) return maxDistance;
  const overshoot = rawDistance - brakeStart;
  return brakeStart + zone * (1 - Math.exp(-overshoot / zone));
}

// Estimates where a vehicle actually is at nowMs, projecting forward from
// its last known fix (lat/lon/bearing/speedKmh/timestamp) at constant
// speed. Returns the vehicle's own [latitude, longitude] unchanged when
// there isn't enough to extrapolate from (no timestamp/bearing, stopped,
// or the fix is somehow from the future).
//
// routePolylines, when given (the line's own trusted route shape, as one or
// more [lat, lon] arrays), makes the projection follow the actual road/rail
// geometry instead of cutting across in a straight line: the vehicle's last
// fix is snapped onto whichever polyline it's closest to, its bearing
// decides whether it's headed toward increasing or decreasing distance
// along that polyline, and the estimate walks that many meters along the
// polyline's own bends. Without a usable route it falls back to a plain
// great-circle projection along the reported bearing.
//
// nearestStopMeters, when given, is the straight-line distance from the
// vehicle's last known fix to the closest stop actually ahead of it (see
// distanceToStopAhead) -- not just the nearest stop in any direction, which
// would also cap a vehicle that just left a stop behind it. A real vehicle
// brakes on approach; a naive constant-speed projection doesn't, and would
// run the marker straight through (and past) a stop it's about to reach
// while waiting for the next real fix. decelerateTowardStop() eases the
// projected travel distance toward just short of that stop instead of
// travelling at a constant speed and stopping dead -- a straight-line
// distance is always <= the along-route distance to the same stop, so it's a
// safe (if slightly conservative) limit either way.
export function estimateVehiclePosition(
  vehicle,
  nowMs,
  { nearestStopMeters = null, stopSafetyMarginM = 15, brakeZoneM = 30, routePolylines = null } = {},
) {
  const { latitude, longitude, bearing, speedKmh, timestamp, moving } = vehicle;
  if (!moving || !timestamp || bearing === null || !speedKmh) return [latitude, longitude];

  const elapsedSeconds = (nowMs - timestamp.getTime()) / 1000;
  if (elapsedSeconds <= 0) return [latitude, longitude];

  let travelDistance = (speedKmh / 3.6) * elapsedSeconds;
  if (nearestStopMeters !== null) {
    travelDistance = decelerateTowardStop(travelDistance, Math.max(nearestStopMeters - stopSafetyMarginM, 0), brakeZoneM);
  }
  if (travelDistance <= 0) return [latitude, longitude];

  const match = routePolylines && routePolylines.length > 0 ? closestProjection([latitude, longitude], routePolylines) : null;
  if (!match) return destinationPoint(latitude, longitude, bearing, travelDistance);

  const { polyline, projection } = match;
  // The vehicle's own bearing tells us which way along the (direction-less)
  // polyline it's headed: within 90 degrees of the local segment heading
  // means increasing distance-along, the opposite way means decreasing.
  const direction = angleBetweenBearings(bearing, projection.bearing) <= 90 ? 1 : -1;
  const targetDistance = Math.max(0, Math.min(projection.totalLength, projection.distanceAlong + direction * travelDistance));
  return pointAtDistanceAlong(polyline, targetDistance);
}

// Straight-line blend between two [lat, lon] points, t clamped to [0, 1].
// Used to ease a marker from wherever it was displayed (its dead-reckoned
// estimate, which may have drifted a little) to a fresh real fix over a
// short window, instead of snapping the moment a new fetch lands.
export function lerpLatLng(from, to, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return [from[0] + (to[0] - from[0]) * clamped, from[1] + (to[1] - from[1]) * clamped];
}

// GTFS-RT's own current_status enum (see vehiclePositions.js's `moving`)
// reflects trip progress -- INCOMING_AT/IN_TRANSIT_TO vs STOPPED_AT -- not
// real physical motion: a bus stuck in traffic, waiting at a light, or
// actually broken down can keep reporting IN_TRANSIT_TO with a reported
// speed of 0 for as long as it likes, which trackStalledSince's plain
// `moving` flag would then never flag as stalled. This instead also treats
// a confirmed zero speed as not moving regardless of that status. A
// missing speed reading (null) isn't treated as proof of a stop, though,
// since plenty of otherwise-normal fixes just omit it.
export function isActuallyMoving(vehicle) {
  return vehicle.moving && vehicle.speedKmh !== 0;
}

// When a vehicle is first observed not actually moving (see
// isActuallyMoving), the stalled clock (see trackStalledSince) should
// start from whichever is earlier: right now, or the vehicle's own last
// reported fix. A fix that's already old by the time we first see it --
// GTFS-RT has stopped refreshing this vehicle's position at all, itself a
// sign something's wrong -- is stronger evidence of how long it's actually
// been stuck than treating this exact moment (whenever a page happens to
// load or reopen this line) as when the problem began. Never later than
// now, in case of clock skew or a genuinely fresh fix; nowMs itself when
// no timestamp is available at all.
export function earliestStillSince(vehicleTimestampMs, nowMs) {
  if (vehicleTimestampMs === null || vehicleTimestampMs === undefined) return nowMs;
  return Math.min(vehicleTimestampMs, nowMs);
}

// Tracks how long a vehicle has been continuously stopped across refreshes.
// A single fix's own timestamp only says when it was last observed, not how
// long it's actually been sitting there, so this instead carries the
// timestamp forward from the same vehicle's previous refresh (matched by
// id) for as long as it stays stopped, resetting to null the moment it
// moves again. previousStalledSince is that prior value, or null if it
// wasn't stopped then (or this is the first time this vehicle's been seen).
export function trackStalledSince(moving, previousStalledSince, nowMs) {
  if (moving) return null;
  return previousStalledSince ?? nowMs;
}

// Whether a vehicle tracked as stopped since stalledSince (see
// trackStalledSince) has been stopped long enough to count as stalled
// rather than just waiting at a stop.
export function isStalled(stalledSince, nowMs, thresholdMs) {
  return stalledSince !== null && nowMs - stalledSince >= thresholdMs;
}
