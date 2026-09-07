// Sanity-check bounds for coordinates coming from TBM's feeds (stop
// locations, live vehicle positions). These feeds occasionally report
// missing or wildly wrong coordinates (e.g. (0, 0), off the coast of
// Africa) -- generous enough to cover all of Bordeaux Metropole with margin,
// tight enough to reject anything that clearly isn't there.
export const BORDEAUX_BOUNDS = { minLat: 44.4, maxLat: 45.2, minLon: -1.2, maxLon: -0.1 };

export function isValidCoordinate(lat, lon) {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    lat >= BORDEAUX_BOUNDS.minLat &&
    lat <= BORDEAUX_BOUNDS.maxLat &&
    lon >= BORDEAUX_BOUNDS.minLon &&
    lon <= BORDEAUX_BOUNDS.maxLon
  );
}

// points is an array of [lat, lon] pairs. Returns null for an empty list.
export function boundsFromPoints(points) {
  if (!points || points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

// Whether two bounding boxes are within marginDeg of touching/overlapping.
export function boundsOverlap(a, b, marginDeg = 0) {
  if (!a || !b) return false;
  return (
    a.minLat - marginDeg <= b.maxLat &&
    a.maxLat + marginDeg >= b.minLat &&
    a.minLon - marginDeg <= b.maxLon &&
    a.maxLon + marginDeg >= b.minLon
  );
}

// Distance in meters between two [lat, lon] points (haversine).
export function distanceMeters([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Whether a route shape actually passes near the stops that are genuinely
// reported for the line it's supposed to be. Bordeaux Metropole's open data
// frequently tags a route shape's "principal" record with the wrong line id
// entirely -- most Locale/Principale/Directe bus lines' shapes turn out on
// inspection to trace a completely unrelated route clear across town. A
// bounding-box check can miss this (the wrong route's box can still overlap
// or nest inside the real one), so this instead checks how many of the
// line's own stops (independently sourced from SIRI-Lite) actually sit near
// the shape: real routes cover 85-100% of their stops within 150m, mistagged
// ones cover under 20%.
export function shapeCoversStops(shapePoints, stopPoints, { thresholdMeters = 150, minFraction = 0.5 } = {}) {
  if (!shapePoints || shapePoints.length === 0 || !stopPoints || stopPoints.length === 0) return false;
  const covered = stopPoints.filter((stop) =>
    shapePoints.some((point) => distanceMeters(stop, point) <= thresholdMeters),
  ).length;
  return covered / stopPoints.length >= minFraction;
}

// Whether point sits within thresholdMeters of at least one of points.
// Used to sanity-check a live vehicle position against the line's own
// stops: TBM's GTFS-RT feed occasionally tags a vehicle with the wrong
// route_id (the same class of mistagging already seen in the static route
// shapes), which places it many kilometers from any stop the line it
// claims to serve actually has -- far more than the gap between two
// consecutive stops on the same route.
export function isNearAnyPoint(point, points, thresholdMeters) {
  if (!point || !points || points.length === 0) return false;
  return points.some((p) => distanceMeters(point, p) <= thresholdMeters);
}

// Distance in meters from point to the closest of points, or null if
// there's nothing to compare against.
export function nearestPointDistance(point, points) {
  if (!point || !points || points.length === 0) return null;
  let min = Infinity;
  for (const p of points) {
    const d = distanceMeters(point, p);
    if (d < min) min = d;
  }
  return min;
}
