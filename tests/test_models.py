from datetime import datetime, timezone

from tbm.models import Passage


def _passage(aimed=None, expected=None):
    return Passage(
        line_ref="bordeaux:Line:A:LOC",
        line_code="A",
        line_name="Tram A",
        destination="Quatre Chemins",
        aimed_time=aimed,
        expected_time=expected,
    )


def test_delay_minutes_and_best_time_use_expected():
    aimed = datetime(2026, 9, 6, 14, 0, tzinfo=timezone.utc)
    expected = datetime(2026, 9, 6, 14, 4, tzinfo=timezone.utc)
    passage = _passage(aimed=aimed, expected=expected)

    assert passage.delay_minutes == 4
    assert passage.best_time == expected


def test_best_time_falls_back_to_aimed_when_no_realtime_data():
    aimed = datetime(2026, 9, 6, 14, 0, tzinfo=timezone.utc)
    passage = _passage(aimed=aimed, expected=None)

    assert passage.best_time == aimed
    assert passage.delay_minutes is None
