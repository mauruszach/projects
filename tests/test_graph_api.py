from tests.conftest import TEST_ACTOR_A, TEST_ACTOR_B, TEST_EVENT_IDS, TEST_LOCATION


def test_get_actor(api_client, seeded_events) -> None:
    response = api_client.get(f"/graph/actors/{TEST_ACTOR_A}")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == TEST_ACTOR_A
    assert body["actor_type"] == "country"


def test_get_actor_not_found(api_client) -> None:
    response = api_client.get("/graph/actors/ZZTEST_DOES_NOT_EXIST")
    assert response.status_code == 404


def test_actor_timeline_returns_events_both_directions(api_client, seeded_events) -> None:
    response = api_client.get(f"/graph/actors/{TEST_ACTOR_A}/timeline")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert {entry["role"] for entry in body} == {"initiated", "targeted"}


def test_actor_timeline_temporal_filter(api_client, seeded_events) -> None:
    response = api_client.get(
        f"/graph/actors/{TEST_ACTOR_A}/timeline",
        params={"start": "2024-01-16T00:00:00Z", "end": "2024-01-17T00:00:00Z"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["event_id"] == TEST_EVENT_IDS[1]


def test_actor_subgraph(api_client, seeded_events) -> None:
    response = api_client.get(f"/graph/actors/{TEST_ACTOR_A}/subgraph")
    assert response.status_code == 200
    body = response.json()
    assert body["actor"]["code"] == TEST_ACTOR_A
    assert {c["code"] for c in body["counterparts"]} == {TEST_ACTOR_B}
    assert {loc["name"] for loc in body["locations"]} == {TEST_LOCATION}
    assert len(body["events"]) == 2


def test_list_events_filters_by_event_code(api_client, seeded_events) -> None:
    response = api_client.get("/events", params={"event_code": "043"})
    assert response.status_code == 200
    body = response.json()
    matching = [e for e in body if e["event_id"] == TEST_EVENT_IDS[0]]
    assert len(matching) == 1
    assert matching[0]["actor1"]["code"] == TEST_ACTOR_A


def test_get_event_by_id(api_client, seeded_events) -> None:
    response = api_client.get(f"/events/{TEST_EVENT_IDS[0]}")
    assert response.status_code == 200
    body = response.json()
    assert body["actor1"]["code"] == TEST_ACTOR_A
    assert body["actor2"]["code"] == TEST_ACTOR_B
    assert body["location"]["name"] == TEST_LOCATION


def test_get_event_not_found(api_client) -> None:
    response = api_client.get("/events/does-not-exist")
    assert response.status_code == 404
