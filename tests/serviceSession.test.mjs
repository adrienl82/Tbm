import assert from "node:assert/strict";
import { test } from "node:test";

import { initialState, sessionIdFor, step } from "../tools/lib/serviceSession.mjs";

// Drives `step` over a list of polls, collecting every event. Each poll is
// [isoTime, liveVehicleCount]; localDate/localHM are derived from the ISO
// string (treated as local for the test) and cutLocal/gapMin are fixed.
function run(polls, { cutLocal = "04:00", gapMin = 45 } = {}) {
  let state = initialState();
  const events = [];
  for (const [iso, live] of polls) {
    const now = new Date(iso);
    const localDate = iso.slice(0, 10);
    const localHM = iso.slice(11, 16);
    const out = step(state, { now, liveVehicleCount: live, localDate, localHM, cutLocal, gapMin });
    state = out.state;
    for (const e of out.events) events.push({ ...e, at: e.at.toISOString() });
  }
  return { state, events };
}

// The real recorder polls every ~20s, so `lastVehicleAt` is always fresh. In
// tests, expand a sparse timeline into `stepMinutes`-spaced polls (each
// carrying the previous entry's live count) so a long span with service
// running doesn't look like a gap. An explicit entry always wins at its time.
function every(stepMinutes, sparse) {
  const out = [];
  for (let i = 0; i < sparse.length; i += 1) {
    out.push(sparse[i]);
    const next = sparse[i + 1];
    if (!next) break;
    let t = Date.parse(sparse[i][0]) + stepMinutes * 60_000;
    while (t < Date.parse(next[0])) {
      out.push([new Date(t).toISOString(), sparse[i][1]]);
      t += stepMinutes * 60_000;
    }
  }
  return out;
}

test("sessionIdFor is a compact UTC stamp to the minute", () => {
  assert.equal(sessionIdFor(new Date("2026-09-09T04:12:34.567Z")), "20260909T0412");
});

test("a session opens on the first circulating vehicle", () => {
  const { events, state } = run([
    ["2026-09-09T04:30:00Z", 0],
    ["2026-09-09T04:45:00Z", 3],
    ["2026-09-09T05:00:00Z", 40],
  ]);
  assert.deepEqual(
    events.map((e) => e.type),
    ["open"],
  );
  assert.equal(events[0].at, "2026-09-09T04:45:00.000Z");
  assert.equal(state.session.id, "20260909T0445");
});

test("no vehicles ever -> no session, no events", () => {
  const { events, state } = run([
    ["2026-09-09T02:00:00Z", 0],
    ["2026-09-09T03:00:00Z", 0],
  ]);
  assert.deepEqual(events, []);
  assert.equal(state.session, null);
});

test("the daily cut closes the running session once, in the early morning", () => {
  const { events } = run(
    every(30, [
      ["2026-09-09T22:00:00Z", 50], // evening service
      ["2026-09-10T04:00:00Z", 4], // night buses kept the feed alive; now at the cut
      ["2026-09-10T09:00:00Z", 60], // full morning service, on the new session
    ]),
  );
  assert.deepEqual(
    events.map((e) => `${e.type}:${e.reason ?? ""}`),
    ["open:", "close:cut", "open:"],
  );
  assert.equal(events[1].at, "2026-09-10T04:00:00.000Z");
  assert.equal(events[2].at, "2026-09-10T04:00:00.000Z"); // same poll: close then reopen
});

test("the cut fires at most once per local day", () => {
  const { events } = run(
    every(30, [
      ["2026-09-10T05:00:00Z", 10], // opens after 04:00; today already marked cut
      ["2026-09-11T05:00:00Z", 10], // only the 04:00 crossing into the 11th cuts
    ]),
  );
  assert.deepEqual(
    events.map((e) => `${e.type}:${e.reason ?? ""}`),
    ["open:", "close:cut", "open:"],
  );
  assert.equal(events[1].at, "2026-09-11T04:00:00.000Z");
});

test("a gap of more than gapMin closes the session as end of service", () => {
  const { events, state } = run([
    ["2026-09-09T00:30:00Z", 5],
    ["2026-09-09T00:45:00Z", 1],
    ["2026-09-09T02:00:00Z", 0], // 75 min since last vehicle > 45
  ]);
  assert.deepEqual(
    events.map((e) => `${e.type}:${e.reason ?? ""}`),
    ["open:", "close:gap"],
  );
  assert.equal(events[1].at, "2026-09-09T02:00:00.000Z");
  assert.equal(state.session, null);
});

test("a brief feed hiccup under gapMin does not close the session", () => {
  const { events } = run([
    ["2026-09-09T10:00:00Z", 40],
    ["2026-09-09T10:10:00Z", 0], // 10 min blip
    ["2026-09-09T10:20:00Z", 38],
  ]);
  assert.deepEqual(
    events.map((e) => e.type),
    ["open"],
  );
});

test("after a gap close, passing the cut time does not spuriously cut the next session", () => {
  const { events } = run([
    ["2026-09-09T01:00:00Z", 5],
    ["2026-09-09T02:30:00Z", 0], // gap close at 02:30 (90 min since last vehicle)
    ["2026-09-09T04:10:00Z", 0], // cut time passes with no session open
    ...every(30, [
      ["2026-09-09T05:00:00Z", 20], // service resumes -> opens, must NOT immediately cut
      ["2026-09-09T08:00:00Z", 50],
    ]),
  ]);
  assert.deepEqual(
    events.map((e) => `${e.type}:${e.reason ?? ""}`),
    ["open:", "close:gap", "open:"],
  );
  assert.equal(events[2].at, "2026-09-09T05:00:00.000Z");
});

test("state round-trips as plain JSON (for state.json persistence)", () => {
  const { state } = run([["2026-09-09T05:00:00Z", 10]]);
  const revived = JSON.parse(JSON.stringify(state));
  assert.deepEqual(revived, state);
  // a fresh reducer can continue from the revived state
  const out = step(revived, {
    now: new Date("2026-09-09T05:05:00Z"),
    liveVehicleCount: 12,
    localDate: "2026-09-09",
    localHM: "05:05",
    cutLocal: "04:00",
    gapMin: 45,
  });
  assert.deepEqual(out.events, []);
  assert.equal(out.state.session.id, state.session.id);
});
