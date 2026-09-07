import assert from "node:assert/strict";
import { test } from "node:test";

import { TbmApiError, TbmClient, groupStopsByName, parseLines, parsePassages, parseStops } from "../js/tbmApi.js";

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

test("parseStops drops coordinates that fall far outside the Bordeaux area", () => {
  const payload = {
    Siri: {
      StopPointsDelivery: {
        AnnotatedStopPointRef: [
          {
            StopPointRef: { value: "bordeaux:StopPoint:BP:9:LOC" },
            StopName: { value: "Null Island" },
            Location: { latitude: 0, longitude: 0 }, // classic GPS-glitch coordinate
            Lines: [],
          },
          {
            StopPointRef: { value: "bordeaux:StopPoint:BP:10:LOC" },
            StopName: { value: "Sans coordonnees" },
            Lines: [], // no Location field at all
          },
          {
            StopPointRef: { value: "bordeaux:StopPoint:BP:11:LOC" },
            StopName: { value: "Quinconces (valide)" },
            Location: { latitude: 44.84, longitude: -0.57 },
            Lines: [],
          },
        ],
      },
    },
  };

  const stops = parseStops(payload);
  assert.deepEqual(
    stops.map((s) => [s.name, s.latitude, s.longitude]),
    [
      ["Null Island", null, null],
      ["Sans coordonnees", null, null],
      ["Quinconces (valide)", 44.84, -0.57],
    ],
  );
});

test("parseLines indexes lines by ref with their public code/name", () => {
  const lines = parseLines(LINES_PAYLOAD);
  const line = lines.get("bordeaux:Line:A:LOC");
  assert.equal(line.code, "A");
  assert.equal(line.name, "Tram A");
});

test("parseLines classifies trams (single-letter code, name starting with Tram) vs everything else as bus", () => {
  const payload = {
    Siri: {
      LinesDelivery: {
        AnnotatedLineRef: [
          { LineRef: { value: "tram-a" }, LineCode: { value: "A" }, LineName: [{ value: "Tram A" }] },
          { LineRef: { value: "liane-2" }, LineCode: { value: "2" }, LineName: [{ value: "Lianes 2" }] },
          // "Navette Tram 100": a rail-replacement shuttle BUS, despite the name -- multi-char code
          { LineRef: { value: "navette-100" }, LineCode: { value: "100" }, LineName: [{ value: "Navette Tram 100" }] },
          // "BUS EXPRESS G": single-letter code but not a tram
          { LineRef: { value: "express-g" }, LineCode: { value: "G" }, LineName: [{ value: "BUS EXPRESS G" }] },
        ],
      },
    },
  };
  const lines = parseLines(payload);
  assert.equal(lines.get("tram-a").mode, "tram");
  assert.equal(lines.get("liane-2").mode, "bus");
  assert.equal(lines.get("navette-100").mode, "bus");
  assert.equal(lines.get("express-g").mode, "bus");
});

test("parsePassages resolves line metadata and computes the delay", () => {
  const lines = parseLines(LINES_PAYLOAD);
  const passages = parsePassages(MONITORING_PAYLOAD, lines);
  assert.equal(passages.length, 1);
  const [passage] = passages;
  assert.equal(passage.lineCode, "A");
  assert.equal(passage.lineName, "Tram A");
  assert.equal(passage.destination, "Quatre Chemins");
  assert.equal(passage.direction, "Quatre Chemins");
  assert.equal(passage.delayMinutes, 3);
  assert.equal(passage.bestTime.toISOString(), "2026-09-06T14:03:00.000Z");
});

test("parsePassages prefers DirectionName for direction but falls back to the destination", () => {
  const lines = parseLines(LINES_PAYLOAD);
  const payload = {
    Siri: {
      ServiceDelivery: {
        StopMonitoringDelivery: [
          {
            Status: true,
            MonitoredStopVisit: [
              {
                MonitoredVehicleJourney: {
                  LineRef: { value: "bordeaux:Line:A:LOC" },
                  DirectionName: [{ value: "Vers le centre" }],
                  DestinationName: [{ value: "Quatre Chemins" }],
                  MonitoredCall: {},
                },
              },
              {
                MonitoredVehicleJourney: {
                  LineRef: { value: "bordeaux:Line:A:LOC" },
                  DestinationName: [{ value: "Quatre Chemins" }],
                  MonitoredCall: {},
                },
              },
            ],
          },
        ],
      },
    },
  };
  const [withDirection, withoutDirection] = parsePassages(payload, lines);
  assert.equal(withDirection.direction, "Vers le centre");
  assert.equal(withoutDirection.direction, "Quatre Chemins");
});

test("parsePassages throws a TbmApiError when the API reports a failure", () => {
  assert.throws(() => parsePassages(MONITORING_ERROR_PAYLOAD, new Map()), TbmApiError);
});

test("groupStopsByName collapses same-name platforms into one entry", () => {
  const stops = [
    { ref: "b", name: "Quinconces", latitude: 0, longitude: 0, lineRefs: ["L2"] },
    { ref: "a", name: "Quinconces", latitude: 0, longitude: 0, lineRefs: ["L60"] },
    { ref: "c", name: "Quinconces", latitude: 0, longitude: 0, lineRefs: [] }, // decommissioned platform
  ];
  const groups = groupStopsByName(stops);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Quinconces");
  assert.deepEqual(groups[0].refs, ["a", "b"]); // inactive "c" dropped, rest sorted by ref
  assert.equal(groups[0].ref, "a");
});

test("groupStopsByName keeps inactive points when a name has no active ones", () => {
  const stops = [{ ref: "x", name: "Depot ferme", latitude: 0, longitude: 0, lineRefs: [] }];
  const groups = groupStopsByName(stops);
  assert.deepEqual(groups[0].refs, ["x"]);
});

test("groupStopsByName keeps distinct names as separate entries", () => {
  const stops = [
    { ref: "a", name: "Quinconces", latitude: 0, longitude: 0, lineRefs: ["L2"] },
    { ref: "b", name: "Gambetta", latitude: 0, longitude: 0, lineRefs: ["L2"] },
  ];
  const groups = groupStopsByName(stops);
  assert.deepEqual(
    groups.map((g) => g.name).sort(),
    ["Gambetta", "Quinconces"],
  );
});

test("groupStopsByName unions the lineRefs served across a name's platforms", () => {
  const stops = [
    { ref: "a", name: "Quinconces", latitude: 0, longitude: 0, lineRefs: ["tram-a"] },
    { ref: "b", name: "Quinconces", latitude: 0, longitude: 0, lineRefs: ["liane-2", "tram-a"] },
  ];
  const [group] = groupStopsByName(stops);
  assert.deepEqual(group.lineRefs.sort(), ["liane-2", "tram-a"]);
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

test("TbmClient.searchStops filters by transport mode", async () => {
  const stopsPayload = {
    Siri: {
      StopPointsDelivery: {
        AnnotatedStopPointRef: [
          {
            StopPointRef: { value: "tram-stop" },
            StopName: { value: "Quinconces" },
            Location: {},
            Lines: [{ value: "tram-a" }],
          },
          {
            StopPointRef: { value: "bus-stop" },
            StopName: { value: "Quatre Chemins" },
            Location: {},
            Lines: [{ value: "liane-2" }],
          },
        ],
      },
    },
  };
  const linesPayload = {
    Siri: {
      LinesDelivery: {
        AnnotatedLineRef: [
          { LineRef: { value: "tram-a" }, LineCode: { value: "A" }, LineName: [{ value: "Tram A" }] },
          { LineRef: { value: "liane-2" }, LineCode: { value: "2" }, LineName: [{ value: "Lianes 2" }] },
        ],
      },
    },
  };
  const client = new TbmClient({
    storage: new MemoryStorage(),
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes("lines-discovery") ? linesPayload : stopsPayload),
    }),
  });

  const tramOnly = await client.searchStops("qu", { modes: ["tram"] });
  assert.deepEqual(tramOnly.map((s) => s.name), ["Quinconces"]);

  const busOnly = await client.searchStops("qu", { modes: ["bus"] });
  assert.deepEqual(busOnly.map((s) => s.name), ["Quatre Chemins"]);

  const both = await client.searchStops("qu", { modes: ["tram", "bus"] });
  assert.deepEqual(
    both.map((s) => s.name).sort(),
    ["Quatre Chemins", "Quinconces"],
  );

  const unfiltered = await client.searchStops("qu");
  assert.equal(unfiltered.length, 2);
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

function monitoringPayloadFor(destination, isoTime) {
  return {
    Siri: {
      ServiceDelivery: {
        StopMonitoringDelivery: [
          {
            Status: true,
            MonitoredStopVisit: [
              {
                MonitoredVehicleJourney: {
                  LineRef: { value: "bordeaux:Line:A:LOC" },
                  DestinationName: [{ value: destination }],
                  MonitoredCall: { ExpectedArrivalTime: isoTime },
                },
              },
            ],
          },
        ],
      },
    },
  };
}

test("TbmClient.stopMonitoring merges and time-sorts passages across several platform refs", async () => {
  const storage = new MemoryStorage();
  const responsesByUrl = {
    "lines-discovery.json": LINES_PAYLOAD,
    a: monitoringPayloadFor("Later Terminus", "2026-09-06T15:00:00Z"),
    b: monitoringPayloadFor("Earlier Terminus", "2026-09-06T14:00:00Z"),
  };
  const client = new TbmClient({
    storage,
    fetchImpl: async (url) => {
      const key = url.includes("lines-discovery")
        ? "lines-discovery.json"
        : new URL(url).searchParams.get("MonitoringRef");
      return { ok: true, json: async () => responsesByUrl[key] };
    },
  });

  const passages = await client.stopMonitoring(["a", "b"]);
  assert.deepEqual(
    passages.map((p) => p.destination),
    ["Earlier Terminus", "Later Terminus"],
  );
});

test("TbmClient.stopMonitoring returns the refs that answered even if others fail", async () => {
  const storage = new MemoryStorage();
  const responsesByUrl = {
    "lines-discovery.json": LINES_PAYLOAD,
    good: monitoringPayloadFor("Quatre Chemins", "2026-09-06T14:00:00Z"),
  };
  const client = new TbmClient({
    storage,
    fetchImpl: async (url) => {
      if (url.includes("lines-discovery")) return { ok: true, json: async () => LINES_PAYLOAD };
      const ref = new URL(url).searchParams.get("MonitoringRef");
      if (ref === "bad") throw new Error("network down");
      return { ok: true, json: async () => responsesByUrl[ref] };
    },
  });

  const passages = await client.stopMonitoring(["good", "bad"]);
  assert.equal(passages.length, 1);
  assert.equal(passages[0].destination, "Quatre Chemins");
});
