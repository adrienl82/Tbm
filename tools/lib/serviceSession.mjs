// Pure state machine that turns a stream of feed polls into "service session"
// boundaries. A service session is Adrien's unit of a TBM operating day: it
// opens when vehicles start circulating and closes either
//
//   - at a fixed local wall-clock time in the early-morning lull (`cutLocal`,
//     e.g. "04:00") -- once per local calendar day, so sessions stay
//     comparable day to day even on nights the feed never fully empties
//     (weekend night buses); or
//   - when no vehicle has been seen for `gapMin` minutes (a genuine end of
//     service).
//
// The reducer is deterministic and timezone-free: the caller passes `now`
// plus its already-computed local date and "HH:MM", and gets back the next
// state and any open/close events. tools/record-feed.mjs owns the I/O
// (directories, streams, state.json); this module owns only the logic, so it
// can be unit-tested with plain sequences.

// Compact UTC id for a session directory: 2026-09-09T04:12:… -> 20260909T0412
export function sessionIdFor(now) {
  return now.toISOString().replace(/[-:]/g, "").slice(0, 13);
}

export function initialState() {
  return { session: null, lastCutDate: null };
}

// state.session, when set: { id, startedAt (ISO string), lastVehicleAt (epoch ms) }
// state.lastCutDate: "YYYY-MM-DD" of the most recent cut boundary we passed.
//
// input: {
//   now: Date,
//   liveVehicleCount: number,   // vehicles actually circulating right now
//   localDate: "YYYY-MM-DD",    // now, in the recorder's local timezone
//   localHM: "HH:MM",           // now, in the recorder's local timezone
//   cutLocal: "HH:MM",          // daily cut time (local)
//   gapMin: number,             // minutes with no vehicle before a session ends
// }
//
// returns { state, events: [{ type: "open"|"close", at: Date, sessionId, reason? }] }
export function step(state, input) {
  const { now, liveVehicleCount, localDate, localHM, cutLocal, gapMin } = input;
  const s = {
    session: state.session ? { ...state.session } : null,
    lastCutDate: state.lastCutDate,
  };
  const events = [];

  // 1. Daily cut boundary -- fires once per local day at/after cutLocal,
  //    whether or not a session is currently open (so a session that opens
  //    later the same day isn't cut again immediately).
  if (localHM >= cutLocal && s.lastCutDate !== localDate) {
    if (s.session) {
      events.push({ type: "close", at: now, sessionId: s.session.id, reason: "cut" });
      s.session = null;
    }
    s.lastCutDate = localDate;
  }

  // 2. End of service -- no vehicle for gapMin minutes.
  if (s.session && now.getTime() - s.session.lastVehicleAt > gapMin * 60_000) {
    events.push({ type: "close", at: now, sessionId: s.session.id, reason: "gap" });
    s.session = null;
  }

  // 3. Start of service -- first vehicle after there was no open session.
  if (!s.session && liveVehicleCount > 0) {
    const id = sessionIdFor(now);
    events.push({ type: "open", at: now, sessionId: id });
    s.session = { id, startedAt: now.toISOString(), lastVehicleAt: now.getTime() };
  }

  // 4. Keep the session alive.
  if (s.session && liveVehicleCount > 0) {
    s.session.lastVehicleAt = now.getTime();
  }

  return { state: s, events };
}
