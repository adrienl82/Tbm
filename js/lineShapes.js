// Fetches a TBM line's route geometry from Bordeaux Metropole's open data
// portal (Opendatasoft), used to draw the line's path on a map. This is a
// different open dataset than the SIRI-Lite real-time feed (tbmApi.js): it
// publishes each line's static route shape (one record per inter-stop
// segment), not live schedules. CORS is open, so the browser calls it
// directly.

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
  return records
    .map((record) => {
      const coordinates = record.fields?.geo_shape?.coordinates;
      if (!coordinates) return null;
      return {
        direction: record.fields.sens === "RETOUR" ? "retour" : "aller",
        // GeoJSON coordinates are [lon, lat]; Leaflet wants [lat, lon].
        latLngs: coordinates.map(([lon, lat]) => [lat, lon]),
      };
    })
    .filter(Boolean);
}

export async function fetchLineShapes(lineRef, { fetchImpl = null } = {}) {
  const fetcher = fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const id = lineNumericId(lineRef);
  if (!id) return [];

  const url = new URL(BASE_URL);
  url.searchParams.set("dataset", DATASET);
  url.searchParams.set("refine.rs_sv_ligne_a", id);
  url.searchParams.set("rows", "1000");

  const response = await fetcher(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en recuperant le trace de la ligne`);
  }
  return parseLineShapes(await response.json());
}
