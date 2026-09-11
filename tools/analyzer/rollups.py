"""Aggregates every processed session's parquet into the series the
dashboard renders. Kept deliberately small for this first pass: an
hour-of-day speed curve per mode, and a session-by-session table. Real
week-over-week / holiday-vs-normal comparisons need more than a couple of
days of history to mean anything -- see build_comparisons(), which reports
however many sessions of each kind actually exist rather than pretending
there's a real trend yet.
"""

from pathlib import Path

import duckdb

from store import parquet_root

# Matches the columns metrics.punctuality_rows() selects -- needed here only
# as a fallback schema for open_rollup_db() when no session has produced a
# punctuality parquet yet (e.g. only pre-2026-09-11 sessions processed so far).
_PUNCTUALITY_COLUMNS = {
    "rt": "VARCHAR", "trip": "VARCHAR", "route": "VARCHAR", "dir": "INTEGER",
    "next_stop": "VARCHAR", "next_stop_seq": "INTEGER", "next_delay_sec": "INTEGER",
    "hour": "BIGINT", "bucket": "VARCHAR",
}


def open_rollup_db(data_dir: Path) -> duckdb.DuckDBPyConnection:
    root = parquet_root(data_dir)
    con = duckdb.connect()
    for name in ("grid", "trips", "sessions", "punctuality"):
        table_dir = root / name
        has_files = table_dir.is_dir() and any(table_dir.glob("*.parquet"))
        if has_files:
            glob = str(table_dir / "*.parquet").replace("\\", "/")
            con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{glob}', union_by_name=true)")
        elif name == "punctuality":
            cols = ", ".join(f"NULL::{t} AS {col}" for col, t in _PUNCTUALITY_COLUMNS.items())
            con.execute(f"CREATE VIEW {name} AS SELECT {cols} WHERE false")
        else:
            raise FileNotFoundError(f"Aucun parquet trouve pour '{name}' sous {table_dir} -- traiter au moins une session d'abord.")
    return con


def _rows(rel) -> list[dict]:
    cols = [d[0] for d in rel.description]
    return [dict(zip(cols, row)) for row in rel.fetchall()]


def hourly_speed_by_mode(con: duckdb.DuckDBPyConnection) -> list[dict]:
    return _rows(con.sql("""
        SELECT mode, extract(hour FROM bin_start) AS hour,
               round(sum(avg_speed_mps * n) / sum(n) * 3.6, 1) AS avg_kmh,
               sum(n) AS n_points
        FROM grid
        GROUP BY mode, hour
        ORDER BY mode, hour
    """))


def daily_sessions(con: duckdb.DuckDBPyConnection) -> list[dict]:
    return _rows(con.sql("""
        SELECT session, start_ft, end_ft, weekday, is_public_holiday, holiday_name,
               is_school_holiday, vacation_name, n_vehicle_rows, n_trips, n_trams, n_buses,
               round(avg_tram_speed_mps * 3.6, 1) AS avg_tram_kmh,
               round(avg_bus_speed_mps * 3.6, 1) AS avg_bus_kmh,
               n_alerts
        FROM sessions
        ORDER BY start_ft
    """))


def build_comparisons(con: duckdb.DuckDBPyConnection) -> dict:
    """Holiday/vacation vs normal-day average speed, with the sample size of
    each side spelled out -- a 1-vs-1 comparison is not a trend, and the
    dashboard says so rather than implying one."""
    return {
        "public_holiday": _rows(con.sql("""
            SELECT is_public_holiday, count(*) AS n_sessions,
                   round(avg(avg_tram_speed_mps) * 3.6, 1) AS avg_tram_kmh
            FROM sessions GROUP BY is_public_holiday
        """)),
        "school_holiday": _rows(con.sql("""
            SELECT is_school_holiday, count(*) AS n_sessions,
                   round(avg(avg_tram_speed_mps) * 3.6, 1) AS avg_tram_kmh
            FROM sessions GROUP BY is_school_holiday
        """)),
        "by_weekday": _rows(con.sql("""
            SELECT weekday, count(*) AS n_sessions,
                   round(avg(avg_tram_speed_mps) * 3.6, 1) AS avg_tram_kmh
            FROM sessions GROUP BY weekday ORDER BY weekday
        """)),
    }


# Numeric GTFS route id -> tram letter, looked up once against SIRI's
# lines-discovery.json (stable; TBM's tram lines don't get renumbered).
TRAM_ROUTE_LETTER = {"59": "A", "60": "B", "61": "C", "62": "D", "163": "E", "164": "F"}

PUNCTUALITY_BUCKETS = ["avance", "heure", "retard_modere", "retard_important"]


def punctuality_overview(con: duckdb.DuckDBPyConnection) -> dict:
    """Network-wide bucket breakdown + how many sessions/observations it's
    built from -- only sessions from 2026-09-11 onward carry a next-stop
    delay at all (see metrics.punctuality_rows), so this is often thin."""
    total = con.sql("SELECT count(*) FROM punctuality").fetchone()[0]
    # No session id is stored per punctuality row (metrics.py keeps it to the
    # columns that matter for the bucket/rollup); distinct calendar days
    # covered is a good enough proxy for "how much data is this built on".
    n_days = con.sql("SELECT count(DISTINCT date_trunc('day', rt::TIMESTAMP)) FROM punctuality").fetchone()[0]
    buckets = _rows(con.sql(f"""
        SELECT bucket, count(*) AS n, round(100.0 * count(*) / {max(total, 1)}, 1) AS pct
        FROM punctuality GROUP BY bucket
    """))
    by_bucket = {b["bucket"]: b for b in buckets}
    ordered = [by_bucket.get(b, {"bucket": b, "n": 0, "pct": 0.0}) for b in PUNCTUALITY_BUCKETS]
    delay = con.sql("SELECT round(avg(next_delay_sec)/60.0,1), round(median(next_delay_sec)/60.0,1) "
                     "FROM punctuality").fetchone()
    return {
        "n_observations": total,
        "n_days": n_days,
        "buckets": ordered,
        "avg_delay_min": delay[0],
        "median_delay_min": delay[1],
    }


def punctuality_by_line(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Per route: on-time % and mean/median delay, worst-first. Route ids are
    left as-is for buses (already self-explanatory, e.g. "60") and relabelled
    to their letter for trams via TRAM_ROUTE_LETTER."""
    rows = _rows(con.sql("""
        SELECT route,
               count(*) AS n,
               round(100.0 * count(*) FILTER (WHERE bucket = 'heure') / count(*), 1) AS pct_ontime,
               round(avg(next_delay_sec) / 60.0, 1) AS avg_delay_min,
               round(median(next_delay_sec) / 60.0, 1) AS median_delay_min
        FROM punctuality
        GROUP BY route
        HAVING count(*) >= 20
        ORDER BY pct_ontime ASC
    """))
    for r in rows:
        r["label"] = TRAM_ROUTE_LETTER.get(r["route"], r["route"])
        r["is_tram"] = r["route"] in TRAM_ROUTE_LETTER
    return rows


def punctuality_by_hour(con: duckdb.DuckDBPyConnection) -> list[dict]:
    return _rows(con.sql("""
        SELECT hour, count(*) AS n,
               round(100.0 * count(*) FILTER (WHERE bucket = 'heure') / count(*), 1) AS pct_ontime,
               round(avg(next_delay_sec) / 60.0, 1) AS avg_delay_min
        FROM punctuality
        GROUP BY hour ORDER BY hour
    """))


def trip_completion_delay(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """One row per observed trip: its LAST recorded delay (the checkpoint
    closest to finishing), i.e. "was this journey on time overall" rather
    than every checkpoint along the way averaged together."""
    return _rows(con.sql("""
        SELECT trip, route, next_delay_sec, bucket FROM (
            SELECT trip, route, next_delay_sec, bucket,
                   row_number() OVER (PARTITION BY trip ORDER BY rt DESC) AS rn
            FROM punctuality
        ) WHERE rn = 1
    """))


def tram_delay_by_stop_sequence(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """(tram line, stop position in the course) -> mean delay -- shows
    whether a line's lateness builds up gradually along its route or jumps at
    a particular point. Trams only: their stop_seq is directly comparable
    trip to trip (same physical route), which isn't as clean for bus routes
    with more schedule variants."""
    routes = "(" + ",".join(f"'{r}'" for r in TRAM_ROUTE_LETTER) + ")"
    rows = _rows(con.sql(f"""
        SELECT route, next_stop_seq AS stop_seq,
               round(avg(next_delay_sec) / 60.0, 2) AS avg_delay_min,
               count(*) AS n
        FROM punctuality
        WHERE route IN {routes} AND next_stop_seq IS NOT NULL
        GROUP BY route, next_stop_seq
        HAVING count(*) >= 5
        ORDER BY route, next_stop_seq
    """))
    for r in rows:
        r["label"] = TRAM_ROUTE_LETTER[r["route"]]
    return rows


# The map re-bins the ~150m stored grid (metrics.GRID_DLAT/DLON -- kept fine
# for later depth) into ~330m cells and drops near-empty ones, purely to keep
# the inlined dataset a reasonable download: at 150m/15min/mode, three days
# of network-wide bus+tram already inline to ~10MB of JSON.
MAP_DLAT = 0.003
MAP_DLON = 0.0042
MAP_MIN_PASSAGES = 3


def grid_for_map(con: duckdb.DuckDBPyConnection) -> list[list]:
    """[cell_lat, cell_lon, hour, mode, n, avg_kmh] per row -- a plain array,
    not a dict, so the inlined JSON isn't paying for repeated key names
    ~100k times over. The map bins by hour rather than the raw 15-min grid
    for the same size reason; dashboard.py's map.html steps its slider by
    hour accordingly."""
    rel = con.sql(f"""
        SELECT
            round(floor(cell_lat / {MAP_DLAT}) * {MAP_DLAT}, 5) AS map_lat,
            round(floor(cell_lon / {MAP_DLON}) * {MAP_DLON}, 5) AS map_lon,
            extract(hour FROM bin_start) AS hour,
            mode,
            sum(n) AS n,
            round(sum(avg_speed_mps * n) / sum(n) * 3.6, 1) AS avg_kmh
        FROM grid
        GROUP BY map_lat, map_lon, hour, mode
        HAVING sum(n) >= {MAP_MIN_PASSAGES}
    """)
    return [list(row) for row in rel.fetchall()]
