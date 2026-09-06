from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.forecasting.features import build_actor_window_sample
from app.forecasting.model import EscalationModel, evaluate
from app.graph import queries
from app.graph.client import Neo4jClient

logger = get_logger(__name__)

FEATURE_WINDOW_HOURS = 8
LABEL_WINDOW_HOURS = 4
STEP_HOURS = 2
MIN_ACTIVE_EVENTS = 20
MIN_WINDOW_EVENTS = 3
TRAIN_FRACTION = 0.7


def _parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


async def build_dataset(
    client: Neo4jClient, day_start: datetime, day_end: datetime
) -> tuple[list[list[float]], list[int]]:
    active = await queries.get_active_actors(client, day_start, day_end, MIN_ACTIVE_EVENTS)
    actor_codes = [row["code"] for row in active]
    logger.info("active_actors_found", count=len(actor_codes))

    X: list[list[float]] = []
    y: list[int] = []

    anchor = day_start
    max_anchor = day_end - timedelta(hours=FEATURE_WINDOW_HOURS + LABEL_WINDOW_HOURS)
    # Samples are generated in time order (all actors per anchor, anchors
    # ascending), so an index-ordered train/test split below is also a
    # chronological split -- the model is evaluated on time it hasn't seen.
    while anchor <= max_anchor:
        feature_end = anchor + timedelta(hours=FEATURE_WINDOW_HOURS)
        label_end = feature_end + timedelta(hours=LABEL_WINDOW_HOURS)
        for code in actor_codes:
            sample = await build_actor_window_sample(
                client, code, anchor, feature_end, label_end, min_events=MIN_WINDOW_EVENTS
            )
            if sample is None:
                continue
            features, label = sample
            X.append(features.to_vector())
            y.append(label)
        anchor += timedelta(hours=STEP_HOURS)

    return X, y


async def run(day: datetime) -> None:
    settings = get_settings()
    client = Neo4jClient(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)

    day_start = day
    day_end = day + timedelta(days=1)
    X, y = await build_dataset(client, day_start, day_end)
    logger.info("dataset_built", n_samples=len(X), n_positive=sum(y))

    if len(X) < 10:
        logger.warning("insufficient_samples_for_backtest", n_samples=len(X))
        await client.close()
        return

    split = int(len(X) * TRAIN_FRACTION)
    X_train, y_train = X[:split], y[:split]
    X_test, y_test = X[split:], y[split:]

    model = EscalationModel()
    model.fit(X_train, y_train)
    report = evaluate(model, X_test, y_test)

    logger.info(
        "backtest_report",
        n_train=len(X_train),
        n_test=report.n_samples,
        n_positive=report.n_positive,
        accuracy=report.accuracy,
        roc_auc=report.roc_auc,
        brier_score=report.brier_score,
        calibration_bins=report.calibration_bins,
        feature_coefficients=report.feature_coefficients,
    )
    for caveat in report.caveats:
        logger.warning("backtest_caveat", caveat=caveat)

    await client.close()


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(
        description=(
            "Train and backtest the escalation forecasting baseline against one "
            "day of GDELT data already loaded into Neo4j."
        )
    )
    parser.add_argument("--day", required=True, help="UTC date to backtest, YYYY-MM-DD")
    args = parser.parse_args()
    asyncio.run(run(_parse_date(args.day)))


if __name__ == "__main__":
    main()
