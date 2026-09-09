import assert from "node:assert/strict";
import { test } from "node:test";
import protobuf from "protobufjs";

import {
  GTFS_REALTIME_PROTO,
  activeRouteIds,
  decodeFeedMessage,
  parseVehiclePositions,
  parseVehiclePositionsForRoutes,
  countByRoute,
  summarizeByDirection,
} from "../js/vehiclePositions.js";

const FeedMessage = protobuf.parse(GTFS_REALTIME_PROTO).root.lookupType("transit_realtime.FeedMessage");
const encodeFeed = (obj) => new Uint8Array(FeedMessage.encode(obj).finish());

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

test("countByRoute counts vehicles per route, busiest first", () => {
  const counts = countByRoute([
    { routeId: "A" },
    { routeId: "B" },
    { routeId: "A" },
    { routeId: "A" },
    { routeId: "B" },
    { routeId: "C" },
  ]);
  assert.deepEqual(counts, [
    { routeId: "A", count: 3 },
    { routeId: "B", count: 2 },
    { routeId: "C", count: 1 },
  ]);
});

test("countByRoute breaks count ties by route id, natural order, with null last", () => {
  const counts = countByRoute([
    { routeId: "10" },
    { routeId: "2" },
    { routeId: null },
    { routeId: "2" },
    { routeId: "10" },
    { routeId: null },
  ]);
  assert.deepEqual(counts, [
    { routeId: "2", count: 2 },
    { routeId: "10", count: 2 },
    { routeId: null, count: 2 },
  ]);
});

test("countByRoute treats a missing route id as null (still ordered by count)", () => {
  assert.deepEqual(countByRoute([{}, { routeId: undefined }, { routeId: "5" }]), [
    { routeId: null, count: 2 },
    { routeId: "5", count: 1 },
  ]);
});

test("countByRoute handles an empty vehicle list", () => {
  assert.deepEqual(countByRoute([]), []);
});

test("parseVehiclePositions exposes the route id as a string", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
  ]);
  assert.equal(parseVehiclePositions(decoded, "59")[0].routeId, "59");
});

test("parseVehiclePositionsForRoutes keeps vehicles on any of several routes", () => {
  const decoded = decodedWith([
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 44.84, longitude: -0.57 } } },
    { vehicle: { trip: { routeId: "24" }, position: { latitude: 44.85, longitude: -0.58 } } },
    { vehicle: { trip: { routeId: "60" }, position: { latitude: 44.86, longitude: -0.59 } } },
  ]);
  const vehicles = parseVehiclePositionsForRoutes(decoded, new Set(["59", "24"]));
  assert.deepEqual(
    vehicles.map((v) => v.routeId).sort(),
    ["24", "59"],
  );
});

test("parseVehiclePositionsForRoutes drops vehicles with no route id, a route id not in the set, or an invalid position", () => {
  const decoded = decodedWith([
    { vehicle: { position: { latitude: 44.84, longitude: -0.57 } } }, // no route id
    { vehicle: { trip: { routeId: "60" }, position: { latitude: 44.84, longitude: -0.57 } } }, // not requested
    { vehicle: { trip: { routeId: "59" }, position: { latitude: 0, longitude: 0 } } }, // GPS glitch
  ]);
  assert.deepEqual(parseVehiclePositionsForRoutes(decoded, new Set(["59"])), []);
});

test("parseVehiclePositionsForRoutes handles an empty or missing entity list", () => {
  assert.deepEqual(parseVehiclePositionsForRoutes({}, new Set(["59"])), []);
  assert.deepEqual(parseVehiclePositionsForRoutes(decodedWith([]), new Set(["59"])), []);
});

// decodeFeedMessage is the shared entry point for raw GTFS-RT bytes -- the
// browser feeds it the CDN `protobuf` global, tools/record-feed.mjs feeds it
// the npm package. Encode with the real embedded schema, round-trip it, and
// check the parse functions accept the result unchanged.
test("decodeFeedMessage turns raw GTFS-RT vehicle bytes into the object the parse functions expect", () => {
  const bytes = encodeFeed({
    entity: [
      {
        vehicle: {
          trip: { tripId: "T1", routeId: "59", directionId: 1 },
          vehicle: { id: "bus-1", label: "GARE" },
          position: { latitude: 44.84, longitude: -0.57, speed: 8 },
          currentStatus: 1,
          stopId: "4970",
          timestamp: 1_700_000_000,
        },
      },
    ],
  });

  const decoded = decodeFeedMessage(bytes, protobuf);
  const [vehicle] = parseVehiclePositions(decoded, "59");
  assert.equal(vehicle.id, "bus-1");
  assert.equal(vehicle.routeId, "59");
  assert.equal(vehicle.speedKmh, 29); // 8 m/s -> 28.8 -> rounded
  assert.equal(vehicle.moving, false); // STOPPED_AT
  assert.deepEqual(vehicle.timestamp, new Date(1_700_000_000 * 1000));
});

// The embedded schema also carries TripUpdate and Alert (unused by the app,
// read by the recorder's --trips / --alerts). Regression guard: a past
// version only defined VehiclePosition, so entity.trip_update / entity.alert
// decoded to nothing and the recorder archived empty rows.
test("decodeFeedMessage decodes a TripUpdate entity's trip, delay and stop_time_update", () => {
  const decoded = decodeFeedMessage(
    encodeFeed({
      entity: [
        {
          id: "RT|trip-1",
          tripUpdate: {
            trip: { tripId: "trip-1", routeId: "12", directionId: 0, startDate: "20260909" },
            delay: 95,
            timestamp: 1_700_000_500,
            stopTimeUpdate: [
              { stopSequence: 4, stopId: "5001", arrival: { delay: 95, time: 1_700_000_600 }, scheduleRelationship: 0 },
            ],
          },
        },
      ],
    }),
    protobuf,
  );

  const tu = decoded.entity[0].tripUpdate;
  assert.equal(tu.trip.tripId, "trip-1");
  assert.equal(tu.trip.startDate, "20260909");
  assert.equal(tu.delay, 95);
  assert.equal(tu.stopTimeUpdate.length, 1);
  assert.equal(tu.stopTimeUpdate[0].stopId, "5001");
  assert.equal(tu.stopTimeUpdate[0].arrival.time, 1_700_000_600);
});

test("decodeFeedMessage decodes an Alert entity's texts, period and informed entities", () => {
  const decoded = decodeFeedMessage(
    encodeFeed({
      entity: [
        {
          id: "RTA:42",
          alert: {
            cause: 2,
            effect: 4,
            activePeriod: [{ start: 1_700_000_000, end: 1_700_100_000 }],
            informedEntity: [{ routeId: "A", directionId: 1 }, { stopId: "9999" }],
            headerText: { translation: [{ text: "Travaux ligne A", language: "fr" }] },
            descriptionText: { translation: [{ text: "Circulation interrompue", language: "fr" }] },
          },
        },
      ],
    }),
    protobuf,
  );

  const a = decoded.entity[0].alert;
  assert.equal(decoded.entity[0].id, "RTA:42");
  assert.equal(a.cause, 2);
  assert.equal(a.effect, 4);
  assert.equal(a.activePeriod[0].start, 1_700_000_000);
  assert.equal(a.informedEntity[0].routeId, "A");
  assert.equal(a.informedEntity[1].stopId, "9999");
  assert.equal(a.headerText.translation[0].text, "Travaux ligne A");
  assert.equal(a.descriptionText.translation[0].text, "Circulation interrompue");
});
