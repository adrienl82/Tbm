"""Finds session directories ready to process, and normalizes their file
layout -- both the current session-* format and the pre-2026-09-10
YYYY-MM-DD one (see tools/README.md), so a couple of legacy days of data
aren't just thrown away.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

SESSION_RE = re.compile(r"^session-\d{8}T\d{4}$")
LEGACY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass
class Session:
    id: str
    dir: Path
    vehicles: Path | None
    trips: Path | None
    alerts: Path | None
    meta: dict
    legacy: bool  # True for a pre-session-format YYYY-MM-DD directory


def _existing(*candidates: Path) -> Path | None:
    for c in candidates:
        if c.exists():
            return c
    return None


def _read_meta(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def find_sessions(data_dir: Path, *, only_unprocessed: bool = True) -> list[Session]:
    out: list[Session] = []
    if not data_dir.exists():
        return out

    for entry in sorted(data_dir.iterdir()):
        if not entry.is_dir():
            continue

        if SESSION_RE.match(entry.name):
            done = entry / "DONE"
            processed = entry / "PROCESSED"
            if not done.exists():
                continue  # still being written
            if only_unprocessed and processed.exists():
                continue
            out.append(
                Session(
                    id=entry.name.removeprefix("session-"),
                    dir=entry,
                    vehicles=_existing(entry / "vehicles.ndjson.gz", entry / "vehicles.ndjson"),
                    trips=_existing(entry / "trips.ndjson.gz", entry / "trips.ndjson"),
                    alerts=_existing(entry / "alerts.ndjson.gz", entry / "alerts.ndjson"),
                    meta=_read_meta(entry / "meta.json"),
                    legacy=False,
                )
            )
        elif LEGACY_RE.match(entry.name):
            processed = entry / "PROCESSED"
            if only_unprocessed and processed.exists():
                continue
            d = entry.name
            out.append(
                Session(
                    id=d.replace("-", "") + "T0000",
                    dir=entry,
                    vehicles=_existing(entry / f"vehicles-{d}.ndjson.gz", entry / f"vehicles-{d}.ndjson"),
                    trips=_existing(entry / f"trips-{d}.ndjson.gz", entry / f"trips-{d}.ndjson"),
                    alerts=_existing(entry / f"alerts-{d}.ndjson.gz", entry / f"alerts-{d}.ndjson"),
                    meta=_read_meta(entry / "meta.json"),
                    legacy=True,
                )
            )
    return out


def mark_processed(session: Session) -> None:
    (session.dir / "PROCESSED").write_text("", encoding="utf-8")
