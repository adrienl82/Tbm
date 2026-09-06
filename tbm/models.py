"""Data structures shared by the TBM API client and the UI layer."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Tuple


@dataclass(frozen=True)
class Stop:
    ref: str
    name: str
    latitude: float
    longitude: float
    line_refs: Tuple[str, ...]


@dataclass(frozen=True)
class Line:
    ref: str
    code: str
    name: str


@dataclass(frozen=True)
class Passage:
    line_ref: str
    line_code: str
    line_name: str
    destination: str
    aimed_time: Optional[datetime]
    expected_time: Optional[datetime]

    @property
    def best_time(self) -> Optional[datetime]:
        """The most accurate time we have for this passage: real-time if TBM
        published one, otherwise the theoretical schedule."""
        return self.expected_time or self.aimed_time

    @property
    def delay_minutes(self) -> Optional[int]:
        if self.aimed_time is None or self.expected_time is None:
            return None
        return round((self.expected_time - self.aimed_time).total_seconds() / 60)
