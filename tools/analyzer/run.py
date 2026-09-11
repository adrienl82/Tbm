#!/usr/bin/env python3
"""Entry point: process every unprocessed session under --data-dir, then
rebuild the rollups and dashboard from everything processed so far.

Local use (against a Samba-mounted copy of the Pi's /share/tbm):
    pip install -r requirements.txt
    python run.py --data-dir R:\\tbm

On the Pi this is meant to run from a small HA add-on (not built yet --
see tools/analyzer/README.md) with --data-dir /share/tbm.
"""

import argparse
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb

import dashboard
import ingest
import metrics
import rollups
import store
from calendars import Calendars
from sessions import Session, find_sessions, mark_processed

LOCAL_TZ = ZoneInfo("Europe/Paris")


def session_date_service(session: Session) -> date:
    """The local calendar date a session counts as ("today's service"), even
    for a session that runs past midnight -- one that opens before its own
    cut time (e.g. a gap-close/reopen in the small hours) still belongs to
    the previous service day."""
    start_iso = session.meta.get("start")
    if not start_iso:
        # Legacy YYYY-MM-DD dirs and any session missing meta.json: fall back
        # to the id's own date.
        digits = session.id[:8]
        return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
    start_utc = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    start_local = start_utc.astimezone(LOCAL_TZ)
    cut = session.meta.get("sessionCut", "04:00")
    cut_h, cut_m = (int(x) for x in cut.split(":"))
    if (start_local.hour, start_local.minute) < (cut_h, cut_m):
        return start_local.date() - timedelta(days=1)
    return start_local.date()


def process_session(data_dir: Path, session: Session, calendars: Calendars) -> None:
    con = duckdb.connect()
    ingest.load_session(con, session)

    day = session_date_service(session)
    tags = calendars.tag(day)
    summary = metrics.session_summary(con, session.id, tags)
    summary["date_service"] = day.isoformat()

    trips_rel = metrics.trip_metrics(con)
    grid_rel = metrics.grid_metrics(con)
    store.write_session(data_dir, session.id, trips_rel, grid_rel, summary)
    con.close()

    mark_processed(session)
    print(f"  {session.id}: {summary['n_vehicle_rows']} points, {summary['n_trips']} courses, "
          f"{summary['n_trams']} trams, {summary['n_buses']} bus -> OK")


def rebuild_dashboard(data_dir: Path) -> None:
    con = rollups.open_rollup_db(data_dir)
    hourly = rollups.hourly_speed_by_mode(con)
    sessions_rows = rollups.daily_sessions(con)
    comparisons = rollups.build_comparisons(con)
    grid_rows = rollups.grid_for_map(con)
    con.close()

    dashboard.write_dashboard(
        data_dir / "analysis" / "dashboard",
        hourly=hourly,
        sessions=sessions_rows,
        comparisons=comparisons,
        grid_rows=grid_rows,
        generated_at=datetime.now().isoformat(timespec="seconds"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", required=True, help="root holding session-*/ dirs (the recorder's --out)")
    parser.add_argument("--session", help="process only this one session id (dir name, e.g. session-20260910T0253)")
    parser.add_argument("--reprocess", action="store_true", help="ignore PROCESSED markers, redo everything")
    parser.add_argument("--dashboard-only", action="store_true", help="skip ingestion, just rebuild the dashboard")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"--data-dir n'existe pas : {data_dir}", file=sys.stderr)
        return 1

    if not args.dashboard_only:
        calendars = Calendars(data_dir / "calendars")
        pending = find_sessions(data_dir, only_unprocessed=not args.reprocess)
        if args.session:
            pending = [s for s in pending if s.dir.name == args.session or s.id == args.session]
        if not pending:
            print("Aucune session a traiter (tout est deja PROCESSED).")
        for session in pending:
            process_session(data_dir, session, calendars)

    print("Reconstruction du tableau de bord...")
    rebuild_dashboard(data_dir)
    print(f"OK -> {data_dir / 'analysis' / 'dashboard' / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
