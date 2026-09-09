import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTripStops } from "../js/tripUpdates.js";

const NOW = new Date("2026-09-09T10:00:00Z");
const at = (min) => Math.floor(NOW.getTime() / 1000) + min * 60;

function decodedWith(entities) {
  return { entity: entities };
}

test("parseTripStops returns a trip's upcoming stops with arrival Dates", () => {
  const decoded = decodedWith([
    {
      tripUpdate: {
        trip: { tripId: "T1", routeId: "59", directionId: 0 },
        delay: 120,
        stopTimeUpdate: [
          { stopSequence: 5, stopId: "9001", arrival: { time: at(3) }, departure: { time: at(3) } },
          { stopSequence: 6, stopId: "9002", arrival: { time: at(7) } },
          { stopSequence: 7, stopId: "9003", departure: { time: at(12) } },
        ],
      },
    },
  ]);
  const result = parseTripStops(decoded, "T1", NOW);
  assert.equal(result.routeId, "59");
  assert.equal(result.delaySec, 120);
  assert.equal(result.stops.length, 3);
  assert.deepEqual(result.stops[0], {
    stopId: "9001",
    sequence: 5,
    arrival: new Date(at(3) * 1000),
    departure: new Date(at(3) * 1000),
  });
  assert.equal(result.stops[1].stopId, "9002");
  assert.equal(result.stops[1].departure, null);
  assert.equal(result.stops[2].arrival, null); // only departure given
});

test("parseTripStops drops stops already well in the past", () => {
  const decoded = decodedWith([
    {
      tripUpdate: {
        trip: { tripId: "T1", routeId: "59" },
        stopTimeUpdate: [
          { stopSequence: 1, stopId: "past", arrival: { time: at(-10) } },
          { stopSequence: 2, stopId: "grace", arrival: { time: at(-0.5) } }, // within 1 min grace
          { stopSequence: 3, stopId: "next", arrival: { time: at(4) } },
        ],
      },
    },
  ]);
  const result = parseTripStops(decoded, "T1", NOW);
  assert.deepEqual(
    result.stops.map((s) => s.stopId),
    ["grace", "next"],
  );
});

test("parseTripStops returns null when no update matches the trip", () => {
  const decoded = decodedWith([
    { tripUpdate: { trip: { tripId: "OTHER" }, stopTimeUpdate: [] } },
    { vehicle: { trip: { tripId: "T1" } } }, // a vehicle entity, not a trip update
  ]);
  assert.equal(parseTripStops(decoded, "T1", NOW), null);
});

test("parseTripStops handles a missing trip id, entity list or stop updates", () => {
  assert.equal(parseTripStops(decodedWith([]), "T1", NOW), null);
  assert.equal(parseTripStops({}, "T1", NOW), null);
  assert.equal(parseTripStops(decodedWith([{ tripUpdate: { trip: { tripId: "x" } } }]), null, NOW), null);
  const noStops = parseTripStops(
    decodedWith([{ tripUpdate: { trip: { tripId: "T1", routeId: "1" } } }]),
    "T1",
    NOW,
  );
  assert.deepEqual(noStops, { tripId: "T1", routeId: "1", delaySec: null, stops: [] });
});
