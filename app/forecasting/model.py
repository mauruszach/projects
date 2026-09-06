from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score

from app.forecasting.features import FEATURE_NAMES

MIN_RELIABLE_SAMPLES = 200


@dataclass
class EvaluationReport:
    n_samples: int
    n_positive: int
    accuracy: float
    roc_auc: float | None
    brier_score: float
    calibration_bins: list[dict]
    feature_coefficients: dict[str, float]
    caveats: list[str] = field(default_factory=list)


class EscalationModel:
    """A simple, interpretable logistic-regression baseline.

    Deliberately not a deep model: the research question is whether graph
    structure carries any signal at all, and a linear model keeps that legible
    via its coefficients (see feature_coefficients()).
    """

    def __init__(self) -> None:
        self._model = LogisticRegression(max_iter=1000)

    def fit(self, X: list[list[float]], y: list[int]) -> None:
        self._model.fit(np.array(X), np.array(y))

    def predict_proba(self, X: list[list[float]]) -> list[float]:
        return self._model.predict_proba(np.array(X))[:, 1].tolist()

    def feature_coefficients(self) -> dict[str, float]:
        return dict(zip(FEATURE_NAMES, self._model.coef_[0].tolist()))


def evaluate(model: EscalationModel, X: list[list[float]], y: list[int]) -> EvaluationReport:
    y_arr = np.array(y)
    probs = np.array(model.predict_proba(X))
    preds = (probs >= 0.5).astype(int)

    n_samples = len(y)
    n_positive = int(y_arr.sum())

    caveats = [
        "CAMEO event codes and the Goldstein scale are a noisy, indirect proxy for "
        "real-world escalation; this evaluation measures agreement with that proxy, "
        "not with ground-truth conflict outcomes."
    ]
    if n_samples < MIN_RELIABLE_SAMPLES:
        caveats.append(
            f"Only {n_samples} samples were available for this backtest -- too few "
            "for a statistically reliable accuracy or calibration estimate. Treat "
            "these numbers as a pipeline smoke test, not a performance claim."
        )
    if n_positive == 0 or n_positive == n_samples:
        caveats.append("All labels are the same class; ROC-AUC is undefined.")

    roc_auc = None
    calibration_bins: list[dict] = []
    if 0 < n_positive < n_samples:
        roc_auc = float(roc_auc_score(y_arr, probs))
        n_bins = max(1, min(5, n_samples // 5))
        frac_pos, mean_pred = calibration_curve(y_arr, probs, n_bins=n_bins)
        calibration_bins = [
            {"mean_predicted": float(mp), "observed_frequency": float(fp)}
            for mp, fp in zip(mean_pred, frac_pos)
        ]

    return EvaluationReport(
        n_samples=n_samples,
        n_positive=n_positive,
        accuracy=float(accuracy_score(y_arr, preds)),
        roc_auc=roc_auc,
        brier_score=float(brier_score_loss(y_arr, probs)),
        calibration_bins=calibration_bins,
        feature_coefficients=model.feature_coefficients(),
        caveats=caveats,
    )
