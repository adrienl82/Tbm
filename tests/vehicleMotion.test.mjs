import assert from "node:assert/strict";
import { test } from "node:test";

import { destinationPoint, estimateVehiclePosition } from "../js/vehicleMotion.js";
import { distanceMeters } from "../js/geoBounds.js";

test("destinationPoint at distance 0 returns (about) the same point", () => {
  const [lat, lon] = destinationPoint(44.84, -0.58, 90, 0);
  assert.ok(Math.abs(lat - 44.84) < 1e-9);
  assert.ok(Math.abs(lon - -0.58) < 1e-9);
});

test("destinationPoint moves the expected real-world distance", () => {
  const dest = destinationPoint(44.84, -0.58, 45, 1000);
  const actual = distanceMeters([44.84, -0.58], dest);
  assert.ok(Math.abs(actual - 1000) < 1, `expected ~1000m, got ${actual}`);
});

test("destinationPoint heading north increases latitude, heading south decreases it", () => {
  const north = destinationPoint(44.84, -0.58, 0, 500);
  const south = destinationPoint(44.84, -0.58, 180, 500);
  assert.ok(north[0] > 44.84);
  assert.ok(south[0] < 44.84);
});

function vehicleAt({
  latitude = 44.84,
  longitude = -0.58,
  bearing = 90,
  speedKmh = 36,
  secondsAgo = 10,
  moving = true,
} = {}) {
  return { latitude, longitude, bearing, speedKmh, moving, timestamp: new Date(Date.now() - secondsAgo * 1000) };
}

test("estimateVehiclePosition projects forward using speed, bearing and elapsed time", () => {
  const vehicle = vehicleAt({ speedKmh: 36, secondsAgo: 10 }); // 10 m/s * 10s = 100m
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now());
  const moved = distanceMeters([44.84, -0.58], [lat, lon]);
  assert.ok(Math.abs(moved - 100) < 2, `expected ~100m, got ${moved}`);
});

test("estimateVehiclePosition returns the raw position when timestamp is missing", () => {
  const vehicle = { latitude: 44.84, longitude: -0.58, bearing: 90, speedKmh: 36, timestamp: null };
  assert.deepEqual(estimateVehiclePosition(vehicle, Date.now()), [44.84, -0.58]);
});

test("estimateVehiclePosition returns the raw position when bearing is missing", () => {
  const vehicle = vehicleAt({ bearing: null });
  assert.deepEqual(estimateVehiclePosition(vehicle, Date.now()), [44.84, -0.58]);
});

test("estimateVehiclePosition returns the raw position for a stopped vehicle (speed 0)", () => {
  const vehicle = vehicleAt({ speedKmh: 0 });
  assert.deepEqual(estimateVehiclePosition(vehicle, Date.now()), [44.84, -0.58]);
});

test("estimateVehiclePosition never drifts a vehicle marked STOPPED_AT even with noisy nonzero speed", () => {
  const vehicle = vehicleAt({ speedKmh: 5, moving: false });
  assert.deepEqual(estimateVehiclePosition(vehicle, Date.now()), [44.84, -0.58]);
});

test("estimateVehiclePosition doesn't move backward for a fix that looks like it's from the future", () => {
  const vehicle = vehicleAt({ secondsAgo: -5 });
  assert.deepEqual(estimateVehiclePosition(vehicle, Date.now()), [44.84, -0.58]);
});

test("estimateVehiclePosition caps travel short of a nearby stop instead of overshooting it", () => {
  // Fast vehicle (25 m/s) that last reported 10s ago (250m of naive travel)
  // but was only 50m from its next stop at that fix.
  const vehicle = vehicleAt({ speedKmh: 90, secondsAgo: 10 });
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now(), { nearestStopMeters: 50, stopSafetyMarginM: 15 });
  const moved = distanceMeters([44.84, -0.58], [lat, lon]);
  assert.ok(Math.abs(moved - 35) < 2, `expected travel capped at ~35m, got ${moved}`);
});

test("estimateVehiclePosition doesn't move past a stop it's already within the safety margin of", () => {
  const vehicle = vehicleAt({ speedKmh: 90, secondsAgo: 10 });
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now(), { nearestStopMeters: 10, stopSafetyMarginM: 15 });
  assert.deepEqual([lat, lon], [44.84, -0.58]);
});
