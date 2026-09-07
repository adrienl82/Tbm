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
// Used to sanity-check that a line's route shape actually passes near the
// stops that are genuinely reported for it -- Bordeaux Metropole's open
// data occasionally tags a route shape with the wrong line id entirely
// (e.g. bus 28's shape record is actually a different, unrelated route),
// which a plain "is this coordinate in Bordeaux" check can't catch since
// the wrong route is still somewhere in Bordeaux.
export function boundsOverlap(a, b, marginDeg = 0) {
  if (!a || !b) return false;
  return (
    a.minLat - marginDeg <= b.maxLat &&
    a.maxLat + marginDeg >= b.minLat &&
    a.minLon - marginDeg <= b.maxLon &&
    a.maxLon + marginDeg >= b.minLon
  );
}
