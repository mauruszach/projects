import random

from app.forecasting.model import MIN_RELIABLE_SAMPLES, EscalationModel, evaluate


def _separable_dataset(n: int, seed: int = 0) -> tuple[list[list[float]], list[int]]:
    rng = random.Random(seed)
    X: list[list[float]] = []
    y: list[int] = []
    for _ in range(n):
        label = rng.randint(0, 1)
        # goldstein_trend is strongly informative; other features are noise.
        base = -3.0 if label == 1 else 3.0
        trend = base + rng.uniform(-0.5, 0.5)
        X.append([rng.uniform(1, 10), rng.uniform(-5, 5), trend, rng.uniform(-5, 5), rng.uniform(-2, 2), rng.uniform(0, 5)])
        y.append(label)
    return X, y


def test_model_fits_and_predicts_probabilities_in_range() -> None:
    X, y = _separable_dataset(50)
    model = EscalationModel()
    model.fit(X, y)
    probs = model.predict_proba(X)
    assert len(probs) == len(X)
    assert all(0.0 <= p <= 1.0 for p in probs)


def test_model_feature_coefficients_named_correctly() -> None:
    X, y = _separable_dataset(50)
    model = EscalationModel()
    model.fit(X, y)
    coefs = model.feature_coefficients()
    assert set(coefs.keys()) == {
        "event_count",
        "avg_goldstein",
        "goldstein_trend",
        "avg_tone",
        "tone_trend",
        "degree",
    }
    # goldstein_trend is the informative feature: strongly negative trend -> label 1.
    assert coefs["goldstein_trend"] < 0


def test_evaluate_flags_small_sample_caveat() -> None:
    X, y = _separable_dataset(20)
    model = EscalationModel()
    model.fit(X, y)
    report = evaluate(model, X, y)
    assert report.n_samples == 20
    assert any("too few" in c for c in report.caveats)
    assert any("noisy, indirect proxy" in c for c in report.caveats)


def test_evaluate_recovers_high_accuracy_on_separable_data() -> None:
    X_train, y_train = _separable_dataset(300, seed=1)
    X_test, y_test = _separable_dataset(MIN_RELIABLE_SAMPLES, seed=2)
    model = EscalationModel()
    model.fit(X_train, y_train)
    report = evaluate(model, X_test, y_test)

    assert report.accuracy > 0.9
    assert report.roc_auc is not None
    assert report.roc_auc > 0.9
    assert not any("too few" in c for c in report.caveats)
    assert len(report.calibration_bins) > 0


def test_evaluate_handles_single_class_test_set() -> None:
    X_train, y_train = _separable_dataset(50)
    model = EscalationModel()
    model.fit(X_train, y_train)

    # A held-out set that happens to be all one class (e.g. a quiet day with
    # no escalation) -- evaluate() must degrade gracefully, not crash.
    X_test = [[1.0, 0.0, 0.0, 0.0, 0.0, 1.0]] * 10
    y_test = [0] * 10
    report = evaluate(model, X_test, y_test)
    assert report.roc_auc is None
    assert any("same class" in c for c in report.caveats)
