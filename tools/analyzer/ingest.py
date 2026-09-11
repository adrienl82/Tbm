"""Loads one session's raw ndjson into DuckDB views. `read_ndjson` is given
explicit column types (rather than `read_ndjson_auto`) for two reasons: it's
faster (no sampling pass), and `ignore_errors=true` only works reliably with
an explicit schema -- auto-detect still aborts the whole read on the odd
malformed line a mid-session process restart can leave behind (observed once
in two days of real capture; see tools/README.md).
"""

import duckdb

from sessions import Session

VEHICLE_COLUMNS = {
    "rt": "VARCHAR",
    "ft": "VARCHAR",
    "id": "VARCHAR",
    "label": "VARCHAR",
    "trip": "VARCHAR",
    "route": "VARCHAR",
    "dir": "INTEGER",
    "lat": "DOUBLE",
    "lon": "DOUBLE",
    "brg": "DOUBLE",
    "spd": "DOUBLE",
    "stop": "VARCHAR",
    "st": "INTEGER",
}

TRIP_COLUMNS = {
    "rt": "VARCHAR",
    "trip": "VARCHAR",
    "route": "VARCHAR",
    "dir": "INTEGER",
    "start_date": "VARCHAR",
    "delay_sec": "INTEGER",
    "next_stop": "VARCHAR",
    "next_stop_seq": "INTEGER",
    "next_time": "VARCHAR",
    "next_delay_sec": "INTEGER",
    "sched_rel": "INTEGER",
}

ALERT_COLUMNS = {
    "rt": "VARCHAR",
    "alert_id": "VARCHAR",
    "cause": "INTEGER",
    "effect": "INTEGER",
    "header": "VARCHAR",
    "description": "VARCHAR",
    "active": "JSON",
    "informed": "JSON",
}


def _read_ndjson_sql(path, columns: dict) -> str:
    cols = ", ".join(f"'{k}':'{v}'" for k, v in columns.items())
    posix = str(path).replace("\\", "/")
    return f"read_ndjson('{posix}', ignore_errors=true, columns={{{cols}}})"


def _empty_sql(columns: dict) -> str:
    # A zero-row relation with the right column names/types -- so a session
    # missing a file (an old capture predating --trips/--alerts, or one run
    # without --raw) still gives downstream queries every column they expect,
    # instead of "column not found".
    cols = ", ".join(f"NULL::{t} AS {name}" for name, t in columns.items())
    return f"SELECT {cols} WHERE false"


def load_session(con: duckdb.DuckDBPyConnection, session: Session) -> None:
    """Registers `vehicles`, `trips`, `alerts` views for this session on the
    given connection (a fresh connection per session keeps state isolated)."""
    if session.vehicles:
        con.execute(f"CREATE OR REPLACE VIEW vehicles AS SELECT * FROM {_read_ndjson_sql(session.vehicles, VEHICLE_COLUMNS)}")
    else:
        con.execute(f"CREATE OR REPLACE VIEW vehicles AS {_empty_sql(VEHICLE_COLUMNS)}")

    if session.trips:
        con.execute(f"CREATE OR REPLACE VIEW trips AS SELECT * FROM {_read_ndjson_sql(session.trips, TRIP_COLUMNS)}")
    else:
        con.execute(f"CREATE OR REPLACE VIEW trips AS {_empty_sql(TRIP_COLUMNS)}")

    if session.alerts:
        # `active`/`informed` are nested JSON -- read as raw JSON, not flattened,
        # since only counts are used for now (see metrics.py).
        con.execute(f"CREATE OR REPLACE VIEW alerts AS SELECT * FROM {_read_ndjson_sql(session.alerts, ALERT_COLUMNS)}")
    else:
        con.execute(f"CREATE OR REPLACE VIEW alerts AS {_empty_sql(ALERT_COLUMNS)}")
