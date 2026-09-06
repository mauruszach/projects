from datetime import datetime, timezone

from scripts.schedule_ingest import _floor_to_interval


def test_floor_to_interval_rounds_down() -> None:
    dt = datetime(2026, 9, 6, 20, 27, 46, 180207, tzinfo=timezone.utc)
    assert _floor_to_interval(dt) == datetime(2026, 9, 6, 20, 15, 0, 0, tzinfo=timezone.utc)


def test_floor_to_interval_exact_boundary_is_unchanged() -> None:
    dt = datetime(2026, 9, 6, 20, 30, 0, 0, tzinfo=timezone.utc)
    assert _floor_to_interval(dt) == dt


def test_floor_to_interval_just_before_boundary() -> None:
    dt = datetime(2026, 9, 6, 20, 44, 59, 999999, tzinfo=timezone.utc)
    assert _floor_to_interval(dt) == datetime(2026, 9, 6, 20, 30, 0, 0, tzinfo=timezone.utc)
