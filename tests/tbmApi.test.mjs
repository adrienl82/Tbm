import assert from "node:assert/strict";
import { test } from "node:test";

import { TbmApiError, TbmClient, parseLines, parsePassages, parseStops } from "../js/tbmApi.js";

const STOPS_PAYLOAD = {
  Siri: {
    StopPointsDelivery: {
      AnnotatedStopPointRef: [
        {
          StopPointRef: { value: "bordeaux:StopPoint:BP:1:LOC" },
          StopName: { value: "Quinconces" },
          Location: { latitude: 44.84, longitude: -0.57 },
          Lines: [{ value: "bordeaux:Line:A:LOC" }],
        },
        {
          StopPointRef: { value: "bordeaux:StopPoint:BP:2:LOC" },
          StopName: { value: "Gambetta" },
          Location: { latitude: 44.84, longitude: -0.58 },
          Lines: [],
        },
      ],
    },
  },
};

const LINES_PAYLOAD = {
  Siri: {
    LinesDelivery: {
      AnnotatedLineRef: [
        {
          LineRef: { value: "bordeaux:Line:A:LOC" },
          LineCode: { value: "A" },
          LineName: [{ value: "Tram A" }],
        },
      ],
    },
  },
};

const MONITORING_PAYLOAD = {
  Siri: {
    ServiceDelivery: {
      StopMonitoringDelivery: [
        {
          Status: true,
          MonitoredStopVisit: [
            {
              MonitoredVehicleJourney: {
                LineRef: { value: "bordeaux:Line:A:LOC" },
                DestinationName: [{ value: "Quatre Chemins" }],
                MonitoredCall: {
                  AimedArrivalTime: "2026-09-06T14:00:00Z",
                  ExpectedArrivalTime: "2026-09-06T14:03:00Z",
                },
              },
            },
          ],
        },
      ],
    },
  },
};

const MONITORING_ERROR_PAYLOAD = {
  Siri: {
    ServiceDelivery: {
      StopMonitoringDelivery: [{ Status: false, ErrorCondition: "unknown stop" }],
    },
  },
};

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, value);
  }
}

function fakeFetch(payload) {
  return async () => ({ ok: true, json: async () => payload });
}

test("parseStops maps the SIRI payload to plain stop objects", () => {
  const stops = parseStops(STOPS_PAYLOAD);
  assert.deepEqual(
    stops.map((s) => s.name),
    ["Quinconces", "Gambetta"],
  );
  assert.equal(stops[0].ref, "bordeaux:StopPoint:BP:1:LOC");
});

test("parseLines indexes lines by ref with their public code/name", () => {
  const lines = parseLines(LINES_PAYLOAD);
  const line = lines.get("bordeaux:Line:A:LOC");
  assert.equal(line.code, "A");
  assert.equal(line.name, "Tram A");
});

test("parsePassages resolves line metadata and computes the delay", () => {
  const lines = parseLines(LINES_PAYLOAD);
  const passages = parsePassages(MONITORING_PAYLOAD, lines);
  assert.equal(passages.length, 1);
  const [passage] = passages;
  assert.equal(passage.lineCode, "A");
  assert.equal(passage.lineName, "Tram A");
  assert.equal(passage.destination, "Quatre Chemins");
  assert.equal(passage.delayMinutes, 3);
  assert.equal(passage.bestTime.toISOString(), "2026-09-06T14:03:00.000Z");
});

test("parsePassages throws a TbmApiError when the API reports a failure", () => {
  assert.throws(() => parsePassages(MONITORING_ERROR_PAYLOAD, new Map()), TbmApiError);
});

test("TbmClient.searchStops is case-insensitive and caches the stop list", async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const client = new TbmClient({
    storage,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => STOPS_PAYLOAD };
    },
  });

  const results = await client.searchStops("quincon");
  assert.deepEqual(
    results.map((s) => s.name),
    ["Quinconces"],
  );

  await client.listStops(); // should be served from cache, not the network
  assert.equal(calls, 1);
});

test("TbmClient.stopMonitoring wires lines and stop-monitoring together", async () => {
  const storage = new MemoryStorage();
  const responses = [LINES_PAYLOAD, MONITORING_PAYLOAD];
  const client = new TbmClient({
    storage,
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift() }),
  });

  const passages = await client.stopMonitoring("bordeaux:StopPoint:BP:1:LOC");
  assert.equal(passages.length, 1);
  assert.equal(passages[0].lineCode, "A");
});
