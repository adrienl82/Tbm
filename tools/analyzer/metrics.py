"""Per-session metrics computed from the ingested views (see ingest.py):
observed per-trip summaries and a spatial/time grid -- the traffic map's
source data. Deliberately observation-only for now: no join against the
static GTFS schedule (see tools/analyzer/README.md for what that would add
and why it's deferred).
"""

import duckdb

# Grid cell size (~150m at Bordeaux's latitude, 44.84N): 1 degree latitude is
# ~111km everywhere: 150/111000 = 0.00135. 1 degree longitude is ~111km *
# cos(44.84deg) = ~78.8km here: 150/78800 = 0.0019. No H3/geo dependency.
GRID_DLAT = 0.00135
GRID_DLON = 0.0019
GRID_BIN = "15 minutes"

# Punctuality buckets, in seconds of delay at a trip's own next-stop
# prediction (negative = running early). Tighter than the +-5min some
# agencies use for infrequent regional trains -- trams/buses here run every
# few minutes, so a few minutes late is already a real wait extension.
DELAY_EARLY_MAX_S = -60  # more than 1 min ahead of prediction
DELAY_ONTIME_MAX_S = 180  # up to 3 min late still counts "on time"
DELAY_MODERATE_MAX_S = 300  # 3-5 min late = "retard modere"; beyond is "important"

_BUCKET_CASE = f"""CASE
    WHEN next_delay_sec < {DELAY_EARLY_MAX_S} THEN 'avance'
    WHEN next_delay_sec <= {DELAY_ONTIME_MAX_S} THEN 'heure'
    WHEN next_delay_sec <= {DELAY_MODERATE_MAX_S} THEN 'retard_modere'
    ELSE 'retard_important'
END"""


def trip_metrics(con: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
    """One row per observed trip: line, direction, headsign, timing,
    distance (summed haversine step between consecutive fixes) and speed
    stats. fully_observed is a coarse heuristic (its first/last fix don't sit
    right at the session's own edges) -- a trip cut short by the session
    boundary would otherwise look like it started or finished instantly."""
    return con.sql(f"""
        WITH v AS (
            SELECT trip, route, dir, label, ft::TIMESTAMP AS ft, lat, lon, spd
            FROM vehicles
            WHERE trip IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
        ),
        ordered AS (
            SELECT *,
                lag(lat) OVER w AS prev_lat,
                lag(lon) OVER w AS prev_lon
            FROM v
            WINDOW w AS (PARTITION BY trip ORDER BY ft)
        ),
        steps AS (
            SELECT trip, ft, spd,
                CASE WHEN prev_lat IS NULL THEN 0 ELSE
                    2 * 6371000 * asin(sqrt(
                        pow(sin(radians(lat - prev_lat) / 2), 2)
                        + cos(radians(prev_lat)) * cos(radians(lat))
                        * pow(sin(radians(lon - prev_lon) / 2), 2)
                    ))
                END AS step_m
            FROM ordered
        ),
        session_span AS (SELECT min(ft) AS s0, max(ft) AS s1 FROM v)
        SELECT
            v.trip,
            any_value(v.route) AS route,
            any_value(v.dir) AS dir,
            mode(v.label) AS headsign,
            min(v.ft) AS first_ft,
            max(v.ft) AS last_ft,
            date_diff('second', min(v.ft), max(v.ft)) AS duration_s,
            count(*) AS n_fixes,
            round(sum(steps.step_m)) AS distance_m,
            round(avg(v.spd), 2) AS avg_speed_mps,
            round(median(v.spd), 2) AS median_speed_mps,
            round(quantile_cont(v.spd, 0.85), 2) AS p85_speed_mps,
            (min(v.ft) > session_span.s0 + INTERVAL '2 minutes'
                AND max(v.ft) < session_span.s1 - INTERVAL '2 minutes') AS fully_observed
        FROM v
        JOIN steps USING (trip, ft)
        CROSS JOIN session_span
        GROUP BY v.trip, session_span.s0, session_span.s1
    """)


def grid_metrics(con: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
    """(cell, 15-min bin, mode) -> passage count + speed stats. `mode` is
    "tram"/"bus", read off the vehicle id's own operator prefix (the same
    ineo-tram:/ineo-bus: split used throughout the app/recorder)."""
    return con.sql(f"""
        SELECT
            floor(lat / {GRID_DLAT}) * {GRID_DLAT} AS cell_lat,
            floor(lon / {GRID_DLON}) * {GRID_DLON} AS cell_lon,
            time_bucket(INTERVAL '{GRID_BIN}', ft::TIMESTAMP) AS bin_start,
            CASE WHEN id LIKE 'ineo-tram:%' THEN 'tram' ELSE 'bus' END AS mode,
            count(*) AS n,
            round(avg(spd), 2) AS avg_speed_mps,
            round(median(spd), 2) AS median_speed_mps
        FROM vehicles
        WHERE spd IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
        GROUP BY 1, 2, 3, 4
    """)


def punctuality_rows(con: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
    """One row per trips.ndjson observation that carries a next-stop delay
    prediction -- TBM's own GTFS-RT computation of observed-vs-scheduled, not
    something reconstructed from the static timetable (which this pipeline
    doesn't ingest -- see tools/analyzer/README.md). Only present from the
    2026-09-11 dedup fix onward (tools/README.md); older sessions simply
    produce an empty relation here, not an error.

    Two rows out of real data get dropped as noise, not signal:
    - next_stop_seq=1: the "delay" there is measured against a vehicle's
      first-stop departure prediction, which drifts around before the trip
      has actually started (observed averaging -5.7min vs. a smooth ramp from
      stop 2 onward) -- not a real lateness reading.
    - |next_delay_sec| > 1800s: rare feed glitches (~164 of ~21.9k rows),
      e.g. one bus trip briefly reporting ~4.3h of "delay" -- these swamp
      per-line means (e.g. turned a 9min median into a 107min average).
    Adds the hour and a punctuality bucket for rollups.punctuality_by_line_hour
    and rollups.trip_completion_delay to slice by."""
    return con.sql(f"""
        SELECT rt, trip, route, dir, next_stop, next_stop_seq, next_delay_sec,
               extract(hour FROM rt::TIMESTAMP) AS hour,
               {_BUCKET_CASE} AS bucket
        FROM trips
        WHERE next_delay_sec IS NOT NULL AND route IS NOT NULL AND trip IS NOT NULL
          AND next_stop_seq != 1
          AND abs(next_delay_sec) <= 1800
    """)


def session_summary(con: duckdb.DuckDBPyConnection, session_id: str, tags: dict) -> dict:
    row = con.sql("""
        SELECT
            min(ft::TIMESTAMP) AS start_ft,
            max(ft::TIMESTAMP) AS end_ft,
            count(*) AS n_vehicle_rows,
            count(DISTINCT trip) AS n_trips,
            count(DISTINCT id) FILTER (WHERE id LIKE 'ineo-tram:%') AS n_trams,
            count(DISTINCT id) FILTER (WHERE id LIKE 'ineo-bus:%') AS n_buses,
            round(avg(spd) FILTER (WHERE id LIKE 'ineo-tram:%'), 2) AS avg_tram_speed_mps,
            round(avg(spd) FILTER (WHERE id LIKE 'ineo-bus:%'), 2) AS avg_bus_speed_mps
        FROM vehicles
    """).fetchone()
    n_alerts = con.sql("SELECT count(DISTINCT alert_id) FROM alerts").fetchone()[0]
    columns = [
        "start_ft", "end_ft", "n_vehicle_rows", "n_trips", "n_trams", "n_buses",
        "avg_tram_speed_mps", "avg_bus_speed_mps",
    ]
    summary = dict(zip(columns, row))
    summary["session"] = session_id
    summary["n_alerts"] = n_alerts
    summary.update(tags)
    return summary
