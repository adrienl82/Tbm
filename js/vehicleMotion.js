// Client-side dead-reckoning for live vehicle markers. TBM's GTFS-RT feed
// only refreshes every ~30s (REFRESH_INTERVAL_MS in app.js); without this, a
// marker sits frozen at its last GPS fix for that whole window, which reads
// as stale rather than "live". Between refreshes, this extrapolates a
// vehicle's current position from its last known fix using its own reported
// speed and bearing.

const EARTH_RADIUS_M = 6371000;

// Destination point given a start point, bearing (degrees from true north)
// and distance (meters), using the standard great-circle formula.
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

// Estimates where a vehicle actually is at nowMs, projecting forward from
// its last known fix (lat/lon/bearing/speedKmh/timestamp) at constant
// speed. Returns the vehicle's own [latitude, longitude] unchanged when
// there isn't enough to extrapolate from (no timestamp/bearing, stopped,
// or the fix is somehow from the future).
//
// nearestStopMeters, when given, is the distance from the vehicle's last
// known fix to its line's closest stop. A real vehicle brakes on approach;
// a naive constant-speed projection doesn't, and would run the marker
// straight through (and past) a stop it's about to reach while waiting for
// the next real fix. Capping the projected travel distance to just short of
// that stop keeps the marker from ever visibly skipping over one.
export function estimateVehiclePosition(vehicle, nowMs, { nearestStopMeters = null, stopSafetyMarginM = 15 } = {}) {
  const { latitude, longitude, bearing, speedKmh, timestamp, moving } = vehicle;
  if (!moving || !timestamp || bearing === null || !speedKmh) return [latitude, longitude];

  const elapsedSeconds = (nowMs - timestamp.getTime()) / 1000;
  if (elapsedSeconds <= 0) return [latitude, longitude];

  let travelDistance = (speedKmh / 3.6) * elapsedSeconds;
  if (nearestStopMeters !== null) {
    travelDistance = Math.min(travelDistance, Math.max(nearestStopMeters - stopSafetyMarginM, 0));
  }
  if (travelDistance <= 0) return [latitude, longitude];

  return destinationPoint(latitude, longitude, bearing, travelDistance);
}
