from unittest.mock import patch

from tbm.api import TbmApiError, TbmClient

STOPS_PAYLOAD = {
    "Siri": {
        "StopPointsDelivery": {
            "AnnotatedStopPointRef": [
                {
                    "StopPointRef": {"value": "bordeaux:StopPoint:BP:1:LOC"},
                    "StopName": {"value": "Quinconces"},
                    "Location": {"latitude": 44.84, "longitude": -0.57},
                    "Lines": [{"value": "bordeaux:Line:A:LOC"}],
                },
                {
                    "StopPointRef": {"value": "bordeaux:StopPoint:BP:2:LOC"},
                    "StopName": {"value": "Gambetta"},
                    "Location": {"latitude": 44.84, "longitude": -0.58},
                    "Lines": [],
                },
            ]
        }
    }
}

LINES_PAYLOAD = {
    "Siri": {
        "LinesDelivery": {
            "AnnotatedLineRef": [
                {
                    "LineRef": {"value": "bordeaux:Line:A:LOC"},
                    "LineCode": {"value": "A"},
                    "LineName": [{"value": "Tram A"}],
                }
            ]
        }
    }
}

MONITORING_PAYLOAD = {
    "Siri": {
        "ServiceDelivery": {
            "StopMonitoringDelivery": [
                {
                    "Status": True,
                    "MonitoredStopVisit": [
                        {
                            "MonitoredVehicleJourney": {
                                "LineRef": {"value": "bordeaux:Line:A:LOC"},
                                "DestinationName": [{"value": "Quatre Chemins"}],
                                "MonitoredCall": {
                                    "AimedArrivalTime": "2026-09-06T14:00:00Z",
                                    "ExpectedArrivalTime": "2026-09-06T14:03:00Z",
                                },
                            }
                        }
                    ],
                }
            ]
        }
    }
}

MONITORING_ERROR_PAYLOAD = {
    "Siri": {
        "ServiceDelivery": {
            "StopMonitoringDelivery": [
                {"Status": False, "ErrorCondition": "unknown stop"}
            ]
        }
    }
}


def test_list_stops_parses_and_caches(tmp_path):
    client = TbmClient(cache_dir=tmp_path)
    with patch("tbm.api._get", return_value=STOPS_PAYLOAD) as mocked_get:
        stops = client.list_stops()
        assert [stop.name for stop in stops] == ["Quinconces", "Gambetta"]
        client.list_stops()  # second call must hit the on-disk cache
        assert mocked_get.call_count == 1


def test_search_stops_is_case_insensitive_and_substring_based(tmp_path):
    client = TbmClient(cache_dir=tmp_path)
    with patch("tbm.api._get", return_value=STOPS_PAYLOAD):
        results = client.search_stops("quincon")
        assert [stop.name for stop in results] == ["Quinconces"]


def test_search_stops_with_blank_query_returns_nothing(tmp_path):
    client = TbmClient(cache_dir=tmp_path)
    assert client.search_stops("   ") == []


def test_stop_monitoring_resolves_line_metadata_and_delay(tmp_path):
    client = TbmClient(cache_dir=tmp_path)
    with patch("tbm.api._get", side_effect=[LINES_PAYLOAD, MONITORING_PAYLOAD]):
        passages = client.stop_monitoring("bordeaux:StopPoint:BP:1:LOC")

    assert len(passages) == 1
    passage = passages[0]
    assert passage.line_code == "A"
    assert passage.line_name == "Tram A"
    assert passage.destination == "Quatre Chemins"
    assert passage.delay_minutes == 3


def test_stop_monitoring_raises_on_api_error(tmp_path):
    client = TbmClient(cache_dir=tmp_path)
    with patch("tbm.api._get", side_effect=[LINES_PAYLOAD, MONITORING_ERROR_PAYLOAD]):
        try:
            client.stop_monitoring("bordeaux:StopPoint:BP:unknown:LOC")
        except TbmApiError as exc:
            assert "unknown stop" in str(exc)
        else:
            raise AssertionError("expected TbmApiError")
