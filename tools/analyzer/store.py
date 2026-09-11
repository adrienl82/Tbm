"""Writes a processed session's metrics to parquet, one file per session per
table so re-running a session is idempotent (it just overwrites its own
files) and nothing needs read-modify-write. rollups.py reads these back with
a glob across all sessions.
"""

from pathlib import Path

import duckdb


def parquet_root(data_dir: Path) -> Path:
    return data_dir / "analysis" / "parquet"


def write_session(data_dir: Path, session_id: str, trips_rel, grid_rel, summary: dict) -> None:
    root = parquet_root(data_dir)
    for name in ("trips", "grid", "sessions"):
        (root / name).mkdir(parents=True, exist_ok=True)

    trips_path = root / "trips" / f"{session_id}.parquet"
    grid_path = root / "grid" / f"{session_id}.parquet"
    summary_path = root / "sessions" / f"{session_id}.parquet"

    trips_rel.to_parquet(str(trips_path))
    grid_rel.to_parquet(str(grid_path))

    # A one-row table, columns/values bound positionally so duckdb infers
    # types itself (including the datetime.datetime start_ft/end_ft) --
    # simpler than dragging in pandas/pyarrow just for this.
    cols = list(summary.keys())
    placeholders = ", ".join(["?"] * len(cols))
    con = duckdb.connect()
    con.execute(
        f"CREATE TABLE s AS SELECT * FROM (VALUES ({placeholders})) AS t({', '.join(cols)})",
        list(summary.values()),
    )
    con.sql("SELECT * FROM s").to_parquet(str(summary_path))
    con.close()
