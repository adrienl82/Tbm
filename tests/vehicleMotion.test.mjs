import assert from "node:assert/strict";
import { test } from "node:test";

import {
  destinationPoint,
  distanceToStopAhead,
  estimateVehiclePosition,
  pointAtDistanceAlong,
  projectOntoPolyline,
} from "../js/vehicleMotion.js";
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

test("distanceToStopAhead ignores a stop behind the vehicle", () => {
  // Vehicle at the origin heading east (90); a stop 100m due west is behind it.
  const stopBehind = destinationPoint(44.84, -0.58, 270, 100);
  assert.equal(distanceToStopAhead([44.84, -0.58], 90, [stopBehind]), null);
});

test("distanceToStopAhead finds a stop ahead within the cone and reports its distance", () => {
  const stopAhead = destinationPoint(44.84, -0.58, 90, 100);
  const d = distanceToStopAhead([44.84, -0.58], 90, [stopAhead]);
  assert.ok(Math.abs(d - 100) < 1, `expected ~100m, got ${d}`);
});

test("distanceToStopAhead picks the closest of several stops ahead", () => {
  const near = destinationPoint(44.84, -0.58, 90, 50);
  const far = destinationPoint(44.84, -0.58, 90, 200);
  const d = distanceToStopAhead([44.84, -0.58], 90, [near, far]);
  assert.ok(Math.abs(d - 50) < 1, `expected ~50m, got ${d}`);
});

test("distanceToStopAhead returns null for empty or missing inputs", () => {
  assert.equal(distanceToStopAhead(null, 90, [[44.84, -0.58]]), null);
  assert.equal(distanceToStopAhead([44.84, -0.58], null, [[44.84, -0.58]]), null);
  assert.equal(distanceToStopAhead([44.84, -0.58], 90, []), null);
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

// A straight east-west stretch, for tests where the exact shape of the
// route doesn't matter, and an L-shaped one for tests where following a
// bend (rather than cutting a straight-line corner) is the point.
const straightPolyline = [
  [44.84, -0.6],
  [44.84, -0.58],
  [44.84, -0.56],
  [44.84, -0.54],
];
const bentPolyline = [
  [44.84, -0.6],
  [44.84, -0.58],
  [44.85, -0.58],
];

test("projectOntoPolyline snaps a point already on the line and reports the right distance along it", () => {
  const projection = projectOntoPolyline([44.84, -0.58], straightPolyline);
  assert.ok(projection.distanceFromPolyline < 1);
  const expectedDistance = distanceMeters([44.84, -0.6], [44.84, -0.58]);
  assert.ok(Math.abs(projection.distanceAlong - expectedDistance) < 1);
});

test("projectOntoPolyline returns null for a degenerate polyline", () => {
  assert.equal(projectOntoPolyline([44.84, -0.58], [[44.84, -0.58]]), null);
  assert.equal(projectOntoPolyline([44.84, -0.58], null), null);
});

test("pointAtDistanceAlong walks the polyline and clamps at its ends", () => {
  assert.deepEqual(pointAtDistanceAlong(straightPolyline, 0), straightPolyline[0]);
  assert.deepEqual(pointAtDistanceAlong(straightPolyline, 1e9), straightPolyline[straightPolyline.length - 1]);
  const halfway = pointAtDistanceAlong(straightPolyline, distanceMeters([44.84, -0.6], [44.84, -0.58]));
  assert.ok(Math.abs(halfway[1] - -0.58) < 0.0001);
});

test("estimateVehiclePosition follows the route polyline forward when bearing matches its heading", () => {
  const vehicle = vehicleAt({ latitude: 44.84, longitude: -0.58, bearing: 90, speedKmh: 36, secondsAgo: 10 });
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now(), { routePolylines: [straightPolyline] });
  assert.ok(Math.abs(lat - 44.84) < 0.0001); // stays on the (flat) line
  assert.ok(lon > -0.58, "should have moved east along the route");
});

test("estimateVehiclePosition follows the route polyline backward when bearing opposes its heading", () => {
  const vehicle = vehicleAt({ latitude: 44.84, longitude: -0.58, bearing: 270, speedKmh: 36, secondsAgo: 10 });
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now(), { routePolylines: [straightPolyline] });
  assert.ok(Math.abs(lat - 44.84) < 0.0001);
  assert.ok(lon < -0.58, "should have moved west along the route");
});

test("estimateVehiclePosition bends with the route instead of cutting a straight-line corner", () => {
  // Sitting right at the bend, heading into the eastbound segment, moving
  // far enough (36 km/h for 60s = 600m) to run onto the northbound leg.
  const vehicle = vehicleAt({ latitude: 44.84, longitude: -0.58, bearing: 90, speedKmh: 36, secondsAgo: 60 });
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now(), { routePolylines: [bentPolyline] });
  // A straight-line (bearing-only) projection would drift southeast/east;
  // following the route instead keeps it on the northbound leg's longitude.
  assert.ok(lat > 44.84, "should have turned onto the northbound leg");
  assert.ok(Math.abs(lon - -0.58) < 0.0001, "should stay on the northbound leg's longitude, not cut the corner");
});

test("estimateVehiclePosition picks whichever candidate polyline the vehicle is actually closest to", () => {
  const farAwayPolyline = [
    [44.9, -0.6],
    [44.9, -0.58],
  ];
  const vehicle = vehicleAt({ latitude: 44.84, longitude: -0.58, bearing: 90, speedKmh: 36, secondsAgo: 10 });
  const [lat] = estimateVehiclePosition(vehicle, Date.now(), { routePolylines: [farAwayPolyline, straightPolyline] });
  assert.ok(Math.abs(lat - 44.84) < 0.01, "should follow the close polyline, not the far one");
});

test("estimateVehiclePosition still caps travel short of a stop while following a route", () => {
  const vehicle = vehicleAt({ latitude: 44.84, longitude: -0.58, bearing: 90, speedKmh: 90, secondsAgo: 10 });
  const [, lon] = estimateVehiclePosition(vehicle, Date.now(), {
    routePolylines: [straightPolyline],
    nearestStopMeters: 50,
    stopSafetyMarginM: 15,
  });
  const moved = distanceMeters([44.84, -0.58], [44.84, lon]);
  assert.ok(Math.abs(moved - 35) < 2, `expected travel capped at ~35m, got ${moved}`);
});
