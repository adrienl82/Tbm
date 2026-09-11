"""Public-holiday and Zone-A school-holiday lookup for a service date.

Two small, keyless public APIs, cached to disk and refreshed weekly so the
analyzer doesn't hit them on every run:

- jours feries (metropole): https://calendrier.api.gouv.fr/jours-feries/metropole/<year>.json
  -> {"2026-05-01": "1er mai", ...}
- vacances scolaires (education.gouv.fr, Bordeaux = Zone A):
  https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records
  -> records with start_date/end_date/description, filtered to Bordeaux.

Bordeaux's académie is Zone A -- confirmed by inspecting the dataset directly
(see tools/README.md).
"""

import json
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

CACHE_MAX_AGE_S = 7 * 24 * 3600
HOLIDAYS_URL = "https://calendrier.api.gouv.fr/jours-feries/metropole/{year}.json"
SCHOOL_URL = (
    "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "fr-en-calendrier-scolaire/records"
)


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _cache_path(calendars_dir: Path, name: str) -> Path:
    calendars_dir.mkdir(parents=True, exist_ok=True)
    return calendars_dir / name


def _load_or_fetch(path: Path, fetch):
    """Returns cached JSON if younger than CACHE_MAX_AGE_S, else re-fetches
    and writes the fresh copy. Falls back to a stale cache if the fetch
    fails (no internet on the Pi that run) rather than crashing the whole
    pipeline over a calendar lookup."""
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_MAX_AGE_S:
        return json.loads(path.read_text(encoding="utf-8"))
    try:
        data = fetch()
        path.write_text(json.dumps(data), encoding="utf-8")
        return data
    except Exception as err:  # noqa: BLE001 -- deliberately broad, see docstring
        if path.exists():
            print(f"calendars: refresh failed ({err}), using stale cache {path.name}")
            return json.loads(path.read_text(encoding="utf-8"))
        raise


def load_public_holidays(calendars_dir: Path, years: list[int]) -> dict[str, str]:
    """{"YYYY-MM-DD": "nom du jour ferie"} across the given years."""
    merged: dict[str, str] = {}
    for year in years:
        path = _cache_path(calendars_dir, f"jours-feries-{year}.json")
        merged.update(_load_or_fetch(path, lambda y=year: _fetch_json(HOLIDAYS_URL.format(year=y))))
    return merged


def load_school_holidays(calendars_dir: Path) -> list[dict]:
    """[{start, end, description}, ...] for Bordeaux (Zone A), all periods
    the dataset currently returns (it spans several school years)."""
    path = _cache_path(calendars_dir, "vacances-zoneA-bordeaux.json")

    def fetch():
        params = urllib.parse.urlencode({"where": 'location="Bordeaux"', "limit": 100})
        payload = _fetch_json(f"{SCHOOL_URL}?{params}")
        periods = []
        for rec in payload.get("results", []):
            start, end = rec.get("start_date"), rec.get("end_date")
            if not start or not end:
                continue
            periods.append(
                {"start": start[:10], "end": end[:10], "description": rec.get("description") or ""}
            )
        return periods

    return _load_or_fetch(path, fetch)


class Calendars:
    """Loaded once per analyzer run, then queried per session date."""

    def __init__(self, calendars_dir: Path, today: date | None = None):
        today = today or date.today()
        years = [today.year - 1, today.year, today.year + 1]
        self.holidays = load_public_holidays(calendars_dir, years)
        self.school_periods = load_school_holidays(calendars_dir)

    def tag(self, day: date) -> dict:
        iso = day.isoformat()
        holiday_name = self.holidays.get(iso)
        vacation = next(
            (p["description"] for p in self.school_periods if p["start"] <= iso <= p["end"]), None
        )
        eve = (day + timedelta(days=1)).isoformat()
        return {
            "weekday": day.isoweekday(),  # 1=Mon .. 7=Sun
            "is_public_holiday": holiday_name is not None,
            "holiday_name": holiday_name,
            "is_school_holiday": vacation is not None,
            "vacation_name": vacation,
            "day_before_holiday": eve in self.holidays,
        }
