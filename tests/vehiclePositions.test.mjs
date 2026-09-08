import assert from "node:assert/strict";
import { test } from "node:test";

import { activeRouteIds, parseVehiclePositions, summarizeByDirection } from "../js/vehiclePositions.js";

function decodedWith(entities) {
  return { entity: entities };
}

test("parseVehiclePositions keeps only vehicles on the requested route", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
    { vehicle: { trip: { routeId: "60" }, position: { latitude: 44.85, longitude: -0.58 } } },
  ]);
  const vehicles = parseVehiclePositions(decoded, "59");
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].latitude, 44.84);
});

test("parseVehiclePositions drops vehicles with no position or a glitched (0,0) fix", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" } } }, // no position at all
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 0, longitude: 0 } } }, // GPS glitch
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } }, // valid
  ]);
  const vehicles = parseVehiclePositions(decoded, "59");
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].latitude, 44.84);
});

test("parseVehiclePositions matches routeId as a string regardless of type", () => {
  const decoded = decodedWith([{ vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } }]);
  assert.equal(parseVehiclePositions(decoded, 59).length, 1);
});

test("parseVehiclePositions exposes id, label and bearing when present", () => {
  const decoded = decodedWith([
    {
      vehicle: {
        trip: { routeId: "59", tripId: "trip-1" },
        vehicle: { id: "ineo-tram:42", label: "GARE ST-JEAN" },
        position: { latitude: 44.84, longitude: -0.57, bearing: 180 },
      },
    },
  ]);
  const [vehicle] = parseVehiclePositions(decoded, "59");
  assert.equal(vehicle.id, "ineo-tram:42");
  assert.equal(vehicle.label, "GARE ST-JEAN");
  assert.equal(vehicle.bearing, 180);
});

test("parseVehiclePositions reports a stopped vehicle as not moving", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 }, currentStatus: 1 } },
  ]);
  assert.equal(parseVehiclePositions(decoded, "59")[0].moving, false);
});

test("parseVehiclePositions reports incoming-at or in-transit vehicles as moving", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 }, currentStatus: 0 } },
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.85, longitude: -0.58 }, currentStatus: 2 } },
  ]);
  const vehicles = parseVehiclePositions(decoded, "59");
  assert.equal(vehicles[0].moving, true);
  assert.equal(vehicles[1].moving, true);
});

test("parseVehiclePositions defaults to moving when current_status is absent", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
  ]);
  assert.equal(parseVehiclePositions(decoded, "59")[0].moving, true);
});

test("parseVehiclePositions exposes speed in km/h and the current stop id when present", () => {
  const decoded = decodedWith([
    {
      vehicle: {
        trip: { routeId: "59" },
        position: { latitude: 44.84, longitude: -0.57, speed: 10 },
        stopId: "9717",
      },
    },
  ]);
  const [vehicle] = parseVehiclePositions(decoded, "59");
  assert.equal(vehicle.speedKmh, 36);
  assert.equal(vehicle.stopId, "9717");
});

test("parseVehiclePositions defaults speed and stop id to null when absent", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
  ]);
  const [vehicle] = parseVehiclePositions(decoded, "59");
  assert.equal(vehicle.speedKmh, null);
  assert.equal(vehicle.stopId, null);
});

test("parseVehiclePositions converts the GTFS-RT Unix-seconds timestamp to a Date", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 }, timestamp: 1700000000 } },
  ]);
  const [vehicle] = parseVehiclePositions(decoded, "59");
  assert.equal(vehicle.timestamp.getTime(), 1700000000 * 1000);
});

test("parseVehiclePositions defaults timestamp to null when absent or zero", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.85, longitude: -0.58 }, timestamp: 0 } },
  ]);
  const vehicles = parseVehiclePositions(decoded, "59");
  assert.equal(vehicles[0].timestamp, null);
  assert.equal(vehicles[1].timestamp, null);
});

test("parseVehiclePositions falls back to the trip id when the vehicle has no id", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59", tripId: "trip-1" }, position: { latitude: 44.84, longitude: -0.57 } } },
  ]);
  assert.equal(parseVehiclePositions(decoded, "59")[0].id, "trip-1");
});

test("parseVehiclePositions handles an empty or missing entity list", () => {
  assert.deepEqual(parseVehiclePositions({}, "59"), []);
  assert.deepEqual(parseVehiclePositions(decodedWith([]), "59"), []);
});

test("activeRouteIds collects the distinct routes with at least one valid-position vehicle", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
    { vehicle: { trip: { routeId: "24" }, position: { latitude: 44.85, longitude: -0.58 } } },
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.86, longitude: -0.59 } } }, // duplicate route
  ]);
  assert.deepEqual([...activeRouteIds(decoded)].sort(), ["24", "59"]);
});

test("activeRouteIds ignores vehicles with a missing or glitched (0,0) position", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" } } }, // no position
    { vehicle: { trip: { routeId: "24" }, position: { latitude: 0, longitude: 0 } } }, // GPS glitch
    { vehicle: { trip: { routeId: "35" }, position: { latitude: 44.84, longitude: -0.57 } } }, // valid
  ]);
  assert.deepEqual([...activeRouteIds(decoded)], ["35"]);
});

test("activeRouteIds handles an empty or missing entity list", () => {
  assert.deepEqual(activeRouteIds({}), new Set());
  assert.deepEqual(activeRouteIds(decodedWith([])), new Set());
});

test("parseVehiclePositions exposes the direction id when present", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59", directionId: 1 }, position: { latitude: 44.84, longitude: -0.57 } } },
  ]);
  assert.equal(parseVehiclePositions(decoded, "59")[0].directionId, 1);
});

test("parseVehiclePositions defaults direction id to null when absent", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
  ]);
  assert.equal(parseVehiclePositions(decoded, "59")[0].directionId, null);
});

test("summarizeByDirection counts vehicles per direction and orders directions ascending", () => {
  const summaries = summarizeByDirection([
    { directionId: 1, label: "Floirac" },
    { directionId: 0, label: "Gare de Bruges" },
    { directionId: 0, label: "Gare de Bruges" },
  ]);
  assert.deepEqual(summaries, [
    { directionId: 0, count: 2, label: "Gare de Bruges" },
    { directionId: 1, count: 1, label: "Floirac" },
  ]);
});

test("summarizeByDirection picks the most common label per direction and sorts unknown direction last", () => {
  const summaries = summarizeByDirection([
    { directionId: null, label: "" },
    { directionId: 1, label: "Galin" },
    { directionId: 1, label: "La Vache" },
    { directionId: 1, label: "Galin" },
  ]);
  assert.deepEqual(summaries, [
    { directionId: 1, count: 3, label: "Galin" },
    { directionId: null, count: 1, label: null },
  ]);
});

test("summarizeByDirection handles an empty vehicle list", () => {
  assert.deepEqual(summarizeByDirection([]), []);
});
