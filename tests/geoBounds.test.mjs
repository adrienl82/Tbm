import assert from "node:assert/strict";
import { test } from "node:test";

import { boundsFromPoints, boundsOverlap, isValidCoordinate } from "../js/geoBounds.js";

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
