import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchLineShapes, lineNumericId, parseLineShapes } from "../js/lineShapes.js";

test("lineNumericId extracts the bare numeric id from a SIRI line ref", () => {
  assert.equal(lineNumericId("bordeaux:Line:59:LOC"), "59");
  assert.equal(lineNumericId("bordeaux:Line:568:LOC"), "568");
});

test("lineNumericId returns null for an unrecognized ref", () => {
  assert.equal(lineNumericId("not-a-line-ref"), null);
  assert.equal(lineNumericId(undefined), null);
});

test("parseLineShapes converts GeoJSON [lon, lat] segments to Leaflet [lat, lon] paths", () => {
  const payload = {
    records: [
      {
        fields: {
          sens: "ALLER",
          geo_shape: {
            coordinates: [
              [-0.57, 44.84],
              [-0.571, 44.841],
            ],
          },
        },
      },
      {
        fields: {
          sens: "RETOUR",
          geo_shape: { coordinates: [[-0.58, 44.85]] },
        },
      },
      { fields: { sens: "ALLER" } }, // no geo_shape: dropped
    ],
  };

  const shapes = parseLineShapes(payload);
  assert.equal(shapes.length, 2);
  assert.deepEqual(shapes[0], {
    direction: "aller",
    latLngs: [
      [44.84, -0.57],
      [44.841, -0.571],
    ],
  });
  assert.deepEqual(shapes[1], { direction: "retour", latLngs: [[44.85, -0.58]] });
});

test("parseLineShapes unpacks a MultiLineString into one shape per sub-line", () => {
  const payload = {
    records: [
      {
        fields: {
          sens: "ALLER",
          geo_shape: {
            type: "MultiLineString",
            coordinates: [
              [
                [-0.57, 44.84],
                [-0.571, 44.841],
              ],
              [
                [-0.58, 44.85],
                [-0.581, 44.851],
              ],
            ],
          },
        },
      },
    ],
  };

  const shapes = parseLineShapes(payload);
  assert.equal(shapes.length, 2);
  assert.deepEqual(
    shapes.map((s) => s.latLngs),
    [
      [
        [44.84, -0.57],
        [44.841, -0.571],
      ],
      [
        [44.85, -0.58],
        [44.851, -0.581],
      ],
    ],
  );
});

test("parseLineShapes drops a segment containing any out-of-bounds point (e.g. a geocoding glitch)", () => {
  const payload = {
    records: [
      {
        fields: {
          sens: "ALLER",
          geo_shape: {
            coordinates: [
              [-0.57, 44.84],
              [45.0, -1.5], // wildly wrong -- e.g. the Indian Ocean
            ],
          },
        },
      },
      {
        fields: {
          sens: "ALLER",
          geo_shape: { coordinates: [[-0.57, 44.84]] },
        },
      },
    ],
  };

  const shapes = parseLineShapes(payload);
  assert.equal(shapes.length, 1);
  assert.deepEqual(shapes[0].latLngs, [[44.84, -0.57]]);
});

test("fetchLineShapes queries the open data API by the line's numeric id", async () => {
  let requestedUrl = null;
  const shapes = await fetchLineShapes("bordeaux:Line:59:LOC", {
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          records: [{ fields: { sens: "ALLER", geo_shape: { coordinates: [[-0.57, 44.84]] } } }],
        }),
      };
    },
  });

  assert.equal(shapes.length, 1);
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.searchParams.get("dataset"), "sv_chem_l");
  assert.equal(parsed.searchParams.get("refine.rs_sv_ligne_a"), "59");
});

test("fetchLineShapes returns an empty list when the line ref can't be parsed", async () => {
  const shapes = await fetchLineShapes("garbage", { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(shapes, []);
});

test("fetchLineShapes throws on an HTTP error", async () => {
  await assert.rejects(
    fetchLineShapes("bordeaux:Line:59:LOC", { fetchImpl: async () => ({ ok: false, status: 500 }) }),
  );
});
