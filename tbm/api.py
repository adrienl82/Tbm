"""Client for Bordeaux Metropole's public SIRI-Lite real-time transport feed.

TBM does not expose a plain RSS feed. Real-time bus/tram data is published as
JSON through the SIRI-Lite web services documented on
https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite
using the shared public account key below (no registration needed).
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Union

import requests

from .models import Line, Passage, Stop

BASE_URL = "https://bdx.mecatran.com/utw/ws/siri/2.0/bordeaux"
ACCOUNT_KEY = "opendata-bordeaux-metropole-flux-gtfs-rt"

STOPS_CACHE_TTL = 24 * 3600
LINES_CACHE_TTL = 24 * 3600


class TbmApiError(RuntimeError):
    """Raised when the TBM SIRI-Lite API returns an unusable response."""


def _get(endpoint: str, params: Optional[dict] = None, timeout: float = 10.0) -> dict:
    query = {"AccountKey": ACCOUNT_KEY, **(params or {})}
    response = requests.get(f"{BASE_URL}/{endpoint}", params=query, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _first_value(entries: Optional[List[dict]], default: str = "") -> str:
    if not entries:
        return default
    return entries[0].get("value", default)


class TbmClient:
    """Thin client around Bordeaux Metropole's public SIRI-Lite feed."""

    def __init__(self, cache_dir: Union[Path, str, None] = None):
        self.cache_dir = Path(cache_dir) if cache_dir else Path.home() / ".cache" / "tbm_app"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._lines_by_ref: Optional[Dict[str, Line]] = None

    # -- stops -----------------------------------------------------------
    def list_stops(self, force_refresh: bool = False) -> List[Stop]:
        payload = self._cached_json(
            self.cache_dir / "stops.json",
            STOPS_CACHE_TTL,
            force_refresh,
            lambda: _get("stoppoints-discovery.json"),
        )
        refs = payload["Siri"]["StopPointsDelivery"].get("AnnotatedStopPointRef", [])
        stops = []
        for entry in refs:
            location = entry.get("Location") or {}
            stops.append(
                Stop(
                    ref=entry["StopPointRef"]["value"],
                    name=entry.get("StopName", {}).get("value", "?"),
                    latitude=location.get("latitude", 0.0),
                    longitude=location.get("longitude", 0.0),
                    line_refs=tuple(line["value"] for line in entry.get("Lines", [])),
                )
            )
        return stops

    def search_stops(self, query: str, limit: int = 30) -> List[Stop]:
        query = query.strip().lower()
        if not query:
            return []
        matches = [stop for stop in self.list_stops() if query in stop.name.lower()]
        matches.sort(key=lambda stop: stop.name)
        return matches[:limit]

    # -- lines -------------------------------------------------------------
    def _lines(self, force_refresh: bool = False) -> Dict[str, Line]:
        if self._lines_by_ref is not None and not force_refresh:
            return self._lines_by_ref
        payload = self._cached_json(
            self.cache_dir / "lines.json",
            LINES_CACHE_TTL,
            force_refresh,
            lambda: _get("lines-discovery.json"),
        )
        refs = payload["Siri"]["LinesDelivery"].get("AnnotatedLineRef", [])
        lines = {}
        for entry in refs:
            ref = entry["LineRef"]["value"]
            lines[ref] = Line(
                ref=ref,
                code=entry.get("LineCode", {}).get("value", ""),
                name=_first_value(entry.get("LineName")),
            )
        self._lines_by_ref = lines
        return lines

    # -- real-time passages ------------------------------------------------
    def stop_monitoring(self, stop_ref: str, limit: int = 10) -> List[Passage]:
        lines = self._lines()
        payload = _get("stop-monitoring.json", {"MonitoringRef": stop_ref})
        deliveries = payload["Siri"]["ServiceDelivery"].get("StopMonitoringDelivery", [])
        if deliveries and deliveries[0].get("Status") is False:
            raise TbmApiError(deliveries[0].get("ErrorCondition", "reponse invalide de l'API TBM"))

        passages = []
        for delivery in deliveries:
            for visit in delivery.get("MonitoredStopVisit", []):
                vehicle_journey = visit["MonitoredVehicleJourney"]
                call = vehicle_journey.get("MonitoredCall", {})
                line_ref = vehicle_journey["LineRef"]["value"]
                line = lines.get(line_ref)
                destination = _first_value(vehicle_journey.get("DestinationName")) or _first_value(
                    vehicle_journey.get("DirectionName"), "?"
                )
                passages.append(
                    Passage(
                        line_ref=line_ref,
                        line_code=line.code if line else line_ref,
                        line_name=line.name if line else "",
                        destination=destination,
                        aimed_time=_parse_time(call.get("AimedArrivalTime")),
                        expected_time=_parse_time(call.get("ExpectedArrivalTime")),
                    )
                )
        passages.sort(key=lambda passage: passage.best_time or datetime.max.replace(tzinfo=timezone.utc))
        return passages[:limit]

    # -- caching -------------------------------------------------------------
    def _cached_json(self, path: Path, ttl: float, force_refresh: bool, fetch: Callable[[], dict]) -> dict:
        if not force_refresh and path.exists() and time.time() - path.stat().st_mtime < ttl:
            try:
                return json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        data = fetch()
        path.write_text(json.dumps(data))
        return data
