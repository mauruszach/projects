from __future__ import annotations

from datetime import datetime, timezone

from app.graph.schema import ActorNode, EventNode, LocationNode, ParsedEvent

EXPECTED_FIELD_COUNT = 61

EVENT_ID_IDX = 0
ACTOR1_BASE = 5
ACTOR2_BASE = 15
EVENT_CODE_IDX = 26
GOLDSTEIN_IDX = 30
AVG_TONE_IDX = 34
ACTION_GEO_FULLNAME_IDX = 52
ACTION_GEO_LAT_IDX = 56
ACTION_GEO_LONG_IDX = 57
DATE_ADDED_IDX = 59
SOURCE_URL_IDX = 60

# Offsets relative to an actor's base index (same layout for Actor1 and Actor2).
_CODE_OFFSET = 0
_NAME_OFFSET = 1
_COUNTRY_CODE_OFFSET = 2
_KNOWN_GROUP_CODE_OFFSET = 3
_TYPE1_CODE_OFFSET = 7


def classify_actor_type(
    actor_code: str, country_code: str, known_group_code: str, type1_code: str
) -> str:
    # CAMEO gives no clean actor-type field; this is a heuristic, not authoritative.
    if known_group_code or type1_code:
        return "org"
    if country_code and country_code == actor_code:
        return "country"
    return "unknown"


def _parse_actor(fields: list[str], base: int) -> ActorNode | None:
    code = fields[base + _CODE_OFFSET]
    if not code:
        return None
    name = fields[base + _NAME_OFFSET] or code
    country_code = fields[base + _COUNTRY_CODE_OFFSET]
    known_group_code = fields[base + _KNOWN_GROUP_CODE_OFFSET]
    type1_code = fields[base + _TYPE1_CODE_OFFSET]
    return ActorNode(
        code=code,
        name=name,
        actor_type=classify_actor_type(code, country_code, known_group_code, type1_code),
    )


def _parse_location(fields: list[str]) -> LocationNode | None:
    name = fields[ACTION_GEO_FULLNAME_IDX]
    if not name:
        return None
    lat_raw = fields[ACTION_GEO_LAT_IDX]
    long_raw = fields[ACTION_GEO_LONG_IDX]
    lat = float(lat_raw) if lat_raw else None
    long_ = float(long_raw) if long_raw else None
    return LocationNode(name=name, lat=lat, long=long_)


def parse_line(line: str) -> ParsedEvent | None:
    fields = line.rstrip("\n").split("\t")
    if len(fields) != EXPECTED_FIELD_COUNT:
        return None

    try:
        event = EventNode(
            event_id=fields[EVENT_ID_IDX],
            event_code=fields[EVENT_CODE_IDX],
            goldstein_scale=float(fields[GOLDSTEIN_IDX]),
            avg_tone=float(fields[AVG_TONE_IDX]),
            timestamp=datetime.strptime(fields[DATE_ADDED_IDX], "%Y%m%d%H%M%S").replace(
                tzinfo=timezone.utc
            ),
            source_url=fields[SOURCE_URL_IDX],
        )
    except (ValueError, IndexError):
        return None

    return ParsedEvent(
        event=event,
        actor1=_parse_actor(fields, ACTOR1_BASE),
        actor2=_parse_actor(fields, ACTOR2_BASE),
        location=_parse_location(fields),
    )
