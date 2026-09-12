import assert from "node:assert/strict";
import { test } from "node:test";

import {
  angleBetweenBearings,
  decelerateTowardStop,
  destinationPoint,
  distanceToStopAhead,
  earliestStillSince,
  estimateVehiclePosition,
  isActuallyMoving,
  isStalled,
  lerpLatLng,
  pointAtDistanceAlong,
  projectOntoPolyline,
  trackStalledSince,
} from "../js/vehicleMotion.js";
import { distanceMeters } from "../js/geoBounds.js";

test("angleBetweenBearings is 0 for identical bearings and wraps correctly near 360/0", () => {
  assert.equal(angleBetweenBearings(90, 90), 0);
  assert.equal(angleBetweenBearings(350, 10), 20);
});

test("angleBetweenBearings caps out at 180 for opposite bearings", () => {
  assert.equal(angleBetweenBearings(0, 180), 180);
  assert.equal(angleBetweenBearings(45, 225), 180);
});

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

test("decelerateTowardStop matches raw distance before the braking zone (plain cruise)", () => {
  assert.equal(decelerateTowardStop(20, 100, 30), 20); // 20m < brakeStart (70m): untouched
});

test("decelerateTowardStop eases toward, but never quite reaches, maxDistance", () => {
  const near = decelerateTowardStop(90, 100, 30); // just past brake-start (70m)
  const far = decelerateTowardStop(500, 100, 30); // way past it
  assert.ok(near > 70 && near < 100, `expected between 70 and 100, got ${near}`);
  assert.ok(far > near, "further naive travel should still creep closer to the stop");
  assert.ok(far < 100, `should never reach maxDistance, got ${far}`);
});

test("decelerateTowardStop returns 0 when there's no room left before the stop", () => {
  assert.equal(decelerateTowardStop(50, 0, 30), 0);
});

test("decelerateTowardStop shrinks the brake zone rather than starting before distance 0", () => {
  // maxDistance (10) is smaller than the default brake zone (30) -- the
  // whole approach should ease, not just the last 30m of a 10m stretch.
  const d = decelerateTowardStop(50, 10, 30);
  assert.ok(d > 0 && d < 10, `expected an eased value between 0 and 10, got ${d}`);
});

test("estimateVehiclePosition eases travel toward a nearby stop instead of freezing dead at a hard cap", () => {
  // Fast vehicle (25 m/s) that last reported 10s ago (250m of naive travel)
  // but was only 50m from its next stop at that fix -- well past where
  // braking (the default last 30m) begins.
  const vehicle = vehicleAt({ speedKmh: 90, secondsAgo: 10 });
  const [lat, lon] = estimateVehiclePosition(vehicle, Date.now(), { nearestStopMeters: 50, stopSafetyMarginM: 15 });
  const moved = distanceMeters([44.84, -0.58], [lat, lon]);
  assert.ok(Math.abs(moved - 35) < 2, `expected travel eased to just under ~35m, got ${moved}`);
});

test("estimateVehiclePosition keeps creeping forward, slower, as it nears the stop rather than stopping dead", () => {
  const vehicle = vehicleAt({ speedKmh: 90, secondsAgo: 8 }); // just entering the braking zone
  const vehicleLater = vehicleAt({ speedKmh: 90, secondsAgo: 12 }); // well into it
  const early = estimateVehiclePosition(vehicle, Date.now(), { nearestStopMeters: 50, stopSafetyMarginM: 15 });
  const later = estimateVehiclePosition(vehicleLater, Date.now(), { nearestStopMeters: 50, stopSafetyMarginM: 15 });
  const earlyMoved = distanceMeters([44.84, -0.58], early);
  const laterMoved = distanceMeters([44.84, -0.58], later);
  assert.ok(laterMoved > earlyMoved, "should still be inching forward, not frozen");
  assert.ok(laterMoved < 35, "should stay short of the cap");
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

test("lerpLatLng returns the start point at t=0 and the end point at t=1", () => {
  assert.deepEqual(lerpLatLng([44.8, -0.6], [44.9, -0.5], 0), [44.8, -0.6]);
  assert.deepEqual(lerpLatLng([44.8, -0.6], [44.9, -0.5], 1), [44.9, -0.5]);
});

test("lerpLatLng blends proportionally in between", () => {
  const [lat, lon] = lerpLatLng([44.8, -0.6], [44.9, -0.5], 0.5);
  assert.ok(Math.abs(lat - 44.85) < 1e-9);
  assert.ok(Math.abs(lon - -0.55) < 1e-9);
});

test("lerpLatLng clamps t outside [0, 1]", () => {
  assert.deepEqual(lerpLatLng([44.8, -0.6], [44.9, -0.5], -1), [44.8, -0.6]);
  assert.deepEqual(lerpLatLng([44.8, -0.6], [44.9, -0.5], 5), [44.9, -0.5]);
});

test("isActuallyMoving trusts a moving vehicle with an unknown or positive speed", () => {
  assert.equal(isActuallyMoving({ moving: true, speedKmh: null }), true);
  assert.equal(isActuallyMoving({ moving: true, speedKmh: 18 }), true);
});

test("isActuallyMoving overrides GTFS's own moving status when speed is confirmed zero", () => {
  // A vehicle can keep reporting IN_TRANSIT_TO (GTFS-RT's own "moving"
  // status) with speed 0 for as long as it's stuck in traffic or actually
  // broken down -- real bus 1064 on line 8 was seen doing exactly this.
  assert.equal(isActuallyMoving({ moving: true, speedKmh: 0 }), false);
});

test("isActuallyMoving is false when GTFS reports the vehicle stopped, regardless of speed", () => {
  assert.equal(isActuallyMoving({ moving: false, speedKmh: 0 }), false);
  assert.equal(isActuallyMoving({ moving: false, speedKmh: null }), false);
});

test("earliestStillSince uses the vehicle's own timestamp when it's older than now", () => {
  assert.equal(earliestStillSince(1000, 9000), 1000);
});

test("earliestStillSince never returns a time later than now", () => {
  // A fix reported in the future (clock skew, or just a very fresh one)
  // shouldn't push the stalled clock's start forward past right now.
  assert.equal(earliestStillSince(9000, 1000), 1000);
});

test("earliestStillSince falls back to now when there's no vehicle timestamp", () => {
  assert.equal(earliestStillSince(null, 5000), 5000);
  assert.equal(earliestStillSince(undefined, 5000), 5000);
});

test("trackStalledSince returns null while the vehicle is moving", () => {
  assert.equal(trackStalledSince(true, 12345, 99999), null);
  assert.equal(trackStalledSince(true, null, 99999), null);
});

test("trackStalledSince starts the clock the first time a stopped vehicle is seen", () => {
  assert.equal(trackStalledSince(false, null, 1000), 1000);
});

test("trackStalledSince carries the same start time forward while still stopped", () => {
  assert.equal(trackStalledSince(false, 1000, 5000), 1000);
});

test("isStalled is false until the threshold is reached, true after", () => {
  assert.equal(isStalled(1000, 1000 + 4 * 60 * 1000, 5 * 60 * 1000), false);
  assert.equal(isStalled(1000, 1000 + 5 * 60 * 1000, 5 * 60 * 1000), true);
  assert.equal(isStalled(1000, 1000 + 6 * 60 * 1000, 5 * 60 * 1000), true);
});

test("isStalled is false for a vehicle that isn't tracked as stopped", () => {
  assert.equal(isStalled(null, 999999, 5 * 60 * 1000), false);
});
