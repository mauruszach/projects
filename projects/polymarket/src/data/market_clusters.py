"""Curated market baskets, defined by real-world structure only.

Rules (CLAUDE.md, "Data and market cluster construction"):

  * A basket is a set of markets that share one real-world question or
    event category. Membership is decided from the market's *question* and
    its Gamma event, never from its price series and never around known
    shock dates.
  * Markets are listed here by Gamma event slug plus a question filter, so
    the basket is reproducible from metadata alone. Which of the listed
    markets actually enter an analysis is decided by preprocessing
    (liquidity floor, coverage, resolution exclusion) with explicit,
    logged thresholds.
  * The analysis window for a basket is the common life span of its
    markets, trimmed by preprocessing's resolution exclusion. It is not
    chosen to bracket any particular event.

Three baskets, one per category the brief names.

Data reality (checked 2026-09-06): Polymarket's CLOB keeps hourly history
only for roughly the trailing month; anything older is daily. All three
baskets are therefore daily series of a few hundred points.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class MarketSpec:
    event_slug: str
    question_contains: str  # substring that selects one market within the event
    label: str


@dataclass(frozen=True)
class Basket:
    name: str
    category: str
    rationale: str
    markets: tuple
    fidelity_minutes: int = 1440
    notes: str = ""


SWING_STATES = ["Pennsylvania", "Michigan", "Wisconsin", "Georgia", "Arizona", "Nevada", "North Carolina"]

BASKETS = {
    # -- election -----------------------------------------------------------
    "election-2024-swing-states": Basket(
        name="election-2024-swing-states",
        category="election",
        rationale=(
            "The seven states that decided the 2024 US presidential election, "
            "one 'Democrat wins <state>' market each. Same election, same "
            "candidates, same national news flow; the joint structure is the "
            "degree to which the states move together."
        ),
        markets=tuple(
            MarketSpec(
                event_slug=f"{state.lower().replace(' ', '-')}-presidential-election-winner",
                question_contains="Will a Democrat win",
                label=f"dem-{state.lower().replace(' ', '-')}",
            )
            for state in SWING_STATES
        ),
        notes="Events open 2024-03-07/08, resolve 2024-11-05. Roughly 240 daily points.",
    ),
    # -- macro --------------------------------------------------------------
    "fed-rate-cuts-2025": Basket(
        name="fed-rate-cuts-2025",
        category="macro",
        rationale=(
            "All nine outcome markets of one Gamma event, 'How many Fed rate "
            "cuts in 2025?'. They price a single underlying distribution, so "
            "their joint structure is tightly constrained and shifts as a "
            "block on FOMC decisions and inflation/jobs releases."
        ),
        markets=tuple(
            MarketSpec(
                event_slug="how-many-fed-rate-cuts-in-2025",
                question_contains=q,
                label=label,
            )
            for q, label in [
                ("Will no Fed rate cuts", "cuts-0"),
                ("Will 1 Fed rate cut", "cuts-1"),
                ("Will 2 Fed rate cuts", "cuts-2"),
                ("Will 3 Fed rate cuts", "cuts-3"),
                ("Will 4 Fed rate cuts", "cuts-4"),
                ("Will 5 Fed rate cuts", "cuts-5"),
                ("Will 6 Fed rate cuts", "cuts-6"),
                ("Will 7 Fed rate cuts", "cuts-7"),
                ("Will 8+ Fed rate cuts", "cuts-8plus"),
            ]
        ),
        notes=(
            "Opens 2024-12-29, resolves 2025-12-10. ~346 daily points. Outcome "
            "markets that become impossible mid-year (e.g. '0 cuts' after the "
            "first cut) collapse to 0 early; preprocessing's resolution "
            "exclusion must handle per-market effective resolution, not only "
            "the event end date."
        ),
    ),
    # -- conflict -----------------------------------------------------------
    "russia-ukraine-2025": Basket(
        name="russia-ukraine-2025",
        category="conflict",
        rationale=(
            "Single-market Gamma events on the Russia-Ukraine war that all "
            "resolve at end of 2025: ceasefire, peace deal, territorial "
            "concession, NATO status, and leadership changes. One conflict, "
            "one negotiation track, one battlefield; the markets are "
            "different resolutions of the same underlying process."
        ),
        markets=(
            MarketSpec("russia-x-ukraine-ceasefire-in-2025", "ceasefire", "ceasefire-2025"),
            MarketSpec("putin-out-as-president-of-russia-in-2025", "Putin", "putin-out-2025"),
            MarketSpec("ukraine-joins-nato-in-2025", "NATO", "ukraine-nato-2025"),
            MarketSpec("ukraine-agrees-not-to-join-nato-before-july", "NATO", "ukraine-no-nato-2025"),
            MarketSpec("zelensky-resigns-in-2025", "Zelensky", "zelensky-resigns-2025"),
            MarketSpec("will-ukraine-agree-to-cede-territory-to-russia", "cede", "cede-territory-2025"),
            MarketSpec("will-putin-meet-with-zelenskyy-in-2025", "Putin", "putin-zelenskyy-meet-2025"),
            MarketSpec("ukraine-signs-peace-deal-with-russia-in-2025", "peace deal", "peace-deal-2025"),
        ),
        notes=(
            "Markets open between 2024-12-29 and 2025-08-12 and all resolve "
            "2025-12-31; the common span depends on which markets clear the "
            "coverage filter. Several are low-volume (hundreds of thousands "
            "USD lifetime) and will be thin; the liquidity floor decides."
        ),
    ),
}


def get_basket(name):
    if name not in BASKETS:
        raise KeyError(f"unknown basket {name!r}; known: {sorted(BASKETS)}")
    return BASKETS[name]
