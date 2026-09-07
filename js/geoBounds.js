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
