from datetime import datetime, timezone

from app.ingestion.gdelt_transform import classify_actor_type, parse_line

# A realistic GDELT 2.0 event row (61 tab-separated fields), USA initiating an
# event of type "043" against RUS, occurring in Geneva.
_SAMPLE_FIELDS = [
    "1",  # GLOBALEVENTID
    "20240115",  # SQLDATE
    "202401",  # MonthYear
    "2024",  # Year
    "2024.0384",  # FractionDate
    "USA",  # Actor1Code
    "UNITED STATES",  # Actor1Name
    "USA",  # Actor1CountryCode
    "",  # Actor1KnownGroupCode
    "",  # Actor1EthnicCode
    "",  # Actor1Religion1Code
    "",  # Actor1Religion2Code
    "",  # Actor1Type1Code
    "",  # Actor1Type2Code
    "",  # Actor1Type3Code
    "RUS",  # Actor2Code
    "RUSSIA",  # Actor2Name
    "RUS",  # Actor2CountryCode
    "",  # Actor2KnownGroupCode
    "",  # Actor2EthnicCode
    "",  # Actor2Religion1Code
    "",  # Actor2Religion2Code
    "",  # Actor2Type1Code
    "",  # Actor2Type2Code
    "",  # Actor2Type3Code
    "1",  # IsRootEvent
    "043",  # EventCode
    "043",  # EventBaseCode
    "04",  # EventRootCode
    "1",  # QuadClass
    "1.9",  # GoldsteinScale
    "5",  # NumMentions
    "3",  # NumSources
    "5",  # NumArticles
    "-2.5",  # AvgTone
    "1",  # Actor1Geo_Type
    "United States",  # Actor1Geo_FullName
    "US",  # Actor1Geo_CountryCode
    "US",  # Actor1Geo_ADM1Code
    "",  # Actor1Geo_ADM2Code
    "39.828",  # Actor1Geo_Lat
    "-98.5795",  # Actor1Geo_Long
    "US",  # Actor1Geo_FeatureID
    "1",  # Actor2Geo_Type
    "Russia",  # Actor2Geo_FullName
    "RS",  # Actor2Geo_CountryCode
    "RS",  # Actor2Geo_ADM1Code
    "",  # Actor2Geo_ADM2Code
    "60.0",  # Actor2Geo_Lat
    "100.0",  # Actor2Geo_Long
    "RS",  # Actor2Geo_FeatureID
    "1",  # ActionGeo_Type
    "Geneva, Geneve, Switzerland",  # ActionGeo_FullName
    "SZ",  # ActionGeo_CountryCode
    "SZ",  # ActionGeo_ADM1Code
    "",  # ActionGeo_ADM2Code
    "46.2",  # ActionGeo_Lat
    "6.1467",  # ActionGeo_Long
    "-2658434",  # ActionGeo_FeatureID
    "20240115120000",  # DATEADDED
    "http://example.com/article",  # SourceURL
]

assert len(_SAMPLE_FIELDS) == 61
_SAMPLE_ROW = "\t".join(_SAMPLE_FIELDS)


def test_parse_line_full_row() -> None:
    record = parse_line(_SAMPLE_ROW)

    assert record is not None
    assert record.event.event_id == "1"
    assert record.event.event_code == "043"
    assert record.event.goldstein_scale == 1.9
    assert record.event.avg_tone == -2.5
    assert record.event.source_url == "http://example.com/article"
    assert record.event.timestamp == datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

    assert record.actor1 is not None
    assert record.actor1.code == "USA"
    assert record.actor1.name == "UNITED STATES"
    assert record.actor1.actor_type == "country"

    assert record.actor2 is not None
    assert record.actor2.code == "RUS"
    assert record.actor2.actor_type == "country"

    assert record.location is not None
    assert record.location.name == "Geneva, Geneve, Switzerland"
    assert record.location.lat == 46.2
    assert record.location.long == 6.1467


def test_parse_line_rejects_malformed_row() -> None:
    assert parse_line("too\tfew\tfields") is None


def test_parse_line_handles_missing_actor2_and_location() -> None:
    fields = list(_SAMPLE_FIELDS)
    fields[15] = ""  # Actor2Code
    fields[52] = ""  # ActionGeo_FullName
    record = parse_line("\t".join(fields))

    assert record is not None
    assert record.actor2 is None
    assert record.location is None
    assert record.actor1 is not None


def test_classify_actor_type_org_from_known_group_code() -> None:
    assert classify_actor_type("REB", "", "REB", "") == "org"


def test_classify_actor_type_unknown_when_no_signal() -> None:
    assert classify_actor_type("XYZ", "ABC", "", "") == "unknown"
