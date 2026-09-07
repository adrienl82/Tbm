// Fetches a TBM line's route geometry from Bordeaux Metropole's open data
// portal (Opendatasoft), used to draw the line's path on a map. This is a
// different open dataset than the SIRI-Lite real-time feed (tbmApi.js): it
// publishes each line's static route shape (one record per inter-stop
// segment), not live schedules. CORS is open, so the browser calls it
// directly.

import { isValidCoordinate } from "./geoBounds.js";

const BASE_URL = "https://opendata.bordeaux-metropole.fr/api/records/1.0/search/";
const DATASET = "sv_chem_l";

// SIRI line refs look like "bordeaux:Line:59:LOC" -- this open data
// dataset keys the same line by that bare numeric id (rs_sv_ligne_a).
export function lineNumericId(lineRef) {
  const match = /^bordeaux:Line:(\w+):LOC$/.exec(lineRef ?? "");
  return match ? match[1] : null;
}

export function parseLineShapes(payload) {
  const records = payload?.records ?? [];
  const shapes = [];
  for (const record of records) {
    const geoShape = record.fields?.geo_shape;
    if (!geoShape?.coordinates) continue;
    const direction = record.fields.sens === "RETOUR" ? "retour" : "aller";

    // This dataset mixes two GeoJSON geometry types: most segments are a
    // flat LineString ([lon, lat] pairs), but a good third are a
    // MultiLineString (an array of those). Treating a MultiLineString's
    // nested coordinates as a flat LineString silently destructures garbage
    // out of it -- exactly the kind of "point in the middle of the ocean"
    // that also forces fitBounds() to zoom out to a continental scale.
    const lines = geoShape.type === "MultiLineString" ? geoShape.coordinates : [geoShape.coordinates];

    for (const line of lines) {
      if (!Array.isArray(line) || !line.every(([lon, lat]) => isValidCoordinate(lat, lon))) continue;
      shapes.push({
        direction,
        // GeoJSON coordinates are [lon, lat]; Leaflet wants [lat, lon].
        latLngs: line.map(([lon, lat]) => [lat, lon]),
      });
    }
  }
  return shapes;
}

export async function fetchLineShapes(lineRef, { fetchImpl = null } = {}) {
  const fetcher = fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const id = lineNumericId(lineRef);
  if (!id) return [];

  const url = new URL(BASE_URL);
  url.searchParams.set("dataset", DATASET);
  url.searchParams.set("refine.rs_sv_ligne_a", id);
  // This dataset otherwise returns every stop-to-stop pair combination on
  // the line (not just consecutive ones), including ones that stray onto
  // a completely different line's real destinations -- "principal" is the
  // dataset's own flag for the actual route shape.
  url.searchParams.set("refine.principal", "True");
  url.searchParams.set("rows", "1000");

  const response = await fetcher(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en recuperant le trace de la ligne`);
  }
  return parseLineShapes(await response.json());
}
