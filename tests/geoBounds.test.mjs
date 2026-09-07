import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundsFromPoints,
  boundsOverlap,
  isNearAnyPoint,
  isValidCoordinate,
  nearestPointDistance,
  shapeCoversStops,
} from "../js/geoBounds.js";

test("isValidCoordinate accepts a real Bordeaux point", () => {
  assert.equal(isValidCoordinate(44.84, -0.57), true);
});

test("isValidCoordinate rejects (0, 0) and other out-of-region points", () => {
  assert.equal(isValidCoordinate(0, 0), false);
  assert.equal(isValidCoordinate(-1.28, 36.82), false); // Nairobi-ish
});

test("isValidCoordinate rejects non-numeric or non-finite values", () => {
  assert.equal(isValidCoordinate(null, -0.57), false);
  assert.equal(isValidCoordinate(44.84, undefined), false);
  assert.equal(isValidCoordinate(NaN, -0.57), false);
});

test("boundsFromPoints returns null for an empty list", () => {
  assert.equal(boundsFromPoints([]), null);
  assert.equal(boundsFromPoints(undefined), null);
});

test("boundsFromPoints computes the enclosing box", () => {
  const bounds = boundsFromPoints([
    [44.8, -0.6],
    [44.9, -0.55],
    [44.85, -0.58],
  ]);
  assert.deepEqual(bounds, { minLat: 44.8, maxLat: 44.9, minLon: -0.6, maxLon: -0.55 });
});

test("boundsOverlap is true for overlapping boxes and false when far apart", () => {
  const bordeaux = { minLat: 44.8, maxLat: 44.9, minLon: -0.6, maxLon: -0.5 };
  const overlapping = { minLat: 44.85, maxLat: 44.95, minLon: -0.55, maxLon: -0.45 };
  const farAway = { minLat: 43.0, maxLat: 43.1, minLon: 1.4, maxLon: 1.5 }; // Toulouse-ish

  assert.equal(boundsOverlap(bordeaux, overlapping), true);
  assert.equal(boundsOverlap(bordeaux, farAway), false);
});

test("boundsOverlap honors the margin for near-but-not-touching boxes", () => {
  const a = { minLat: 44.8, maxLat: 44.9, minLon: -0.6, maxLon: -0.5 };
  const b = { minLat: 44.91, maxLat: 45.0, minLon: -0.6, maxLon: -0.5 }; // 0.01 deg gap

  assert.equal(boundsOverlap(a, b), false);
  assert.equal(boundsOverlap(a, b, 0.02), true);
});

test("boundsOverlap returns false when either box is missing", () => {
  const a = { minLat: 44.8, maxLat: 44.9, minLon: -0.6, maxLon: -0.5 };
  assert.equal(boundsOverlap(a, null), false);
  assert.equal(boundsOverlap(null, a), false);
});

test("shapeCoversStops is true when the shape passes near most stops", () => {
  const shape = [
    [44.84, -0.58],
    [44.85, -0.57],
    [44.86, -0.56],
  ];
  const stops = [
    [44.8401, -0.5799], // a few meters from a shape point
    [44.8501, -0.5701],
    [44.8599, -0.5601],
  ];
  assert.equal(shapeCoversStops(shape, stops), true);
});

test("shapeCoversStops is false when the shape is an unrelated route", () => {
  // Bordeaux Metropole's open data sometimes tags a "principal" shape with
  // the wrong line entirely -- a route clear across town whose bounding box
  // can still overlap or nest inside the real one, which is exactly why this
  // check looks at actual stop proximity instead of bounding boxes.
  const shape = [
    [44.87, -0.48],
    [44.88, -0.49],
  ];
  const stops = [
    [44.80, -0.65],
    [44.79, -0.64],
    [44.81, -0.66],
  ];
  assert.equal(shapeCoversStops(shape, stops), false);
});

test("shapeCoversStops honors a custom threshold and minimum fraction", () => {
  const shape = [[44.84, -0.58]];
  const stops = [
    [44.8401, -0.5799], // ~15m away
    [44.90, -0.60], // far away
  ];
  assert.equal(shapeCoversStops(shape, stops, { thresholdMeters: 50, minFraction: 0.5 }), true);
  assert.equal(shapeCoversStops(shape, stops, { thresholdMeters: 50, minFraction: 0.9 }), false);
});

test("shapeCoversStops returns false for empty inputs", () => {
  assert.equal(shapeCoversStops([], [[44.84, -0.58]]), false);
  assert.equal(shapeCoversStops([[44.84, -0.58]], []), false);
});

test("isNearAnyPoint is true within the threshold and false beyond it", () => {
  const stops = [
    [44.84, -0.58],
    [44.85, -0.57],
  ];
  assert.equal(isNearAnyPoint([44.8401, -0.5799], stops, 150), true); // a few meters away
  assert.equal(isNearAnyPoint([44.78, -0.62], stops, 1000), false); // Talence-ish, ~8km off
});

test("isNearAnyPoint returns false for empty or missing inputs", () => {
  assert.equal(isNearAnyPoint(null, [[44.84, -0.58]], 500), false);
  assert.equal(isNearAnyPoint([44.84, -0.58], [], 500), false);
  assert.equal(isNearAnyPoint([44.84, -0.58], null, 500), false);
});

test("nearestPointDistance finds the closest of several points", () => {
  const points = [
    [44.9, -0.6], // far
    [44.8401, -0.5799], // a few meters from [44.84, -0.58]
    [43.3, -0.37], // very far
  ];
  const d = nearestPointDistance([44.84, -0.58], points);
  assert.ok(d < 20, `expected a few meters, got ${d}`);
});

test("nearestPointDistance returns null for empty or missing inputs", () => {
  assert.equal(nearestPointDistance(null, [[44.84, -0.58]]), null);
  assert.equal(nearestPointDistance([44.84, -0.58], []), null);
  assert.equal(nearestPointDistance([44.84, -0.58], null), null);
});
