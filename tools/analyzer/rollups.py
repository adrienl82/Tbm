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


def open_rollup_db(data_dir: Path) -> duckdb.DuckDBPyConnection:
    root = parquet_root(data_dir)
    con = duckdb.connect()
    for name in ("grid", "trips", "sessions"):
        glob = str(root / name / "*.parquet").replace("\\", "/")
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{glob}', union_by_name=true)")
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
