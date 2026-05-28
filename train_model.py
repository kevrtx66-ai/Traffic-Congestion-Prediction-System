"""
Training pipeline for congestion model.

Usage:
    python train_model.py
    python train_model.py --data data/traffic_data.csv --out models/congestion_model.pkl
"""

import argparse
import json
import os
import pickle
from dataclasses import dataclass
from typing import Dict, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


DEFAULT_DATA_PATH = "data/traffic_training_data.csv"
DEFAULT_MODEL_PATH = "models/congestion_model.pkl"
DEFAULT_REPORT_PATH = "models/evaluation_report.json"


@dataclass
class DatasetBundle:
    x: np.ndarray
    y: np.ndarray
    df: pd.DataFrame
    rows: int


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def generate_synthetic_dataset(path: str, n_rows: int = 2500) -> None:
    """Generate a realistic starter dataset when no CSV is available yet."""
    rng = np.random.default_rng(42)

    # Around Haldia + nearby spread
    lat = rng.normal(loc=22.0667, scale=0.03, size=n_rows)
    lon = rng.normal(loc=88.0698, scale=0.03, size=n_rows)
    hour = rng.integers(0, 24, size=n_rows)
    minute = rng.integers(0, 60, size=n_rows)
    day_of_week = rng.integers(0, 7, size=n_rows)
    day_of_month = rng.integers(1, 29, size=n_rows)
    month = rng.integers(1, 13, size=n_rows)

    rush_hour = ((hour >= 7) & (hour <= 9)) | ((hour >= 17) & (hour <= 20))
    lunch_hour = (hour >= 12) & (hour <= 14)
    weekend = day_of_week >= 5

    # Base synthetic signal
    congestion = (
        35
        + 25 * rush_hour.astype(int)
        + 8 * lunch_hour.astype(int)
        - 6 * weekend.astype(int)
        + 10 * np.sin((hour / 24) * 2 * np.pi)
        + rng.normal(0, 7, size=n_rows)
    )

    # Slight location effect
    congestion += (lat - 22.0667) * 120 + (lon - 88.0698) * 110
    congestion = np.clip(congestion, 0, 100)

    df = pd.DataFrame(
        {
            "lat": lat.round(6),
            "lon": lon.round(6),
            "hour": hour,
            "minute": minute,
            "day_of_week": day_of_week,
            "day_of_month": day_of_month,
            "month": month,
            "congestion_level": congestion.round(2),
        }
    )

    _ensure_parent_dir(path)
    df.to_csv(path, index=False)


def load_dataset(csv_path: str) -> DatasetBundle:
    """Load dataset from CSV; supports timestamp-based or feature-column format."""
    if not os.path.exists(csv_path):
        generate_synthetic_dataset(csv_path)

    df = pd.read_csv(csv_path)

    required_feature_cols = ["lat", "lon", "hour", "minute", "day_of_week", "day_of_month", "month"]
    if "congestion_level" not in df.columns:
        raise ValueError("CSV must contain 'congestion_level' column.")

    # Support CSV with timestamp instead of expanded time features.
    if not all(col in df.columns for col in required_feature_cols):
        if "timestamp" not in df.columns or not all(col in df.columns for col in ["lat", "lon"]):
            raise ValueError(
                "CSV must contain either full feature columns or at least lat/lon/timestamp/congestion_level."
            )
        ts = pd.to_datetime(df["timestamp"], errors="coerce")
        if ts.isna().any():
            raise ValueError("Some timestamp values are invalid.")
        df["hour"] = ts.dt.hour
        df["minute"] = ts.dt.minute
        df["day_of_week"] = ts.dt.weekday
        df["day_of_month"] = ts.dt.day
        df["month"] = ts.dt.month

    df = df.dropna(subset=required_feature_cols + ["congestion_level"])

    # Add coarse spatial grid for grouped evaluation slices.
    df["zone_id"] = (
        df["lat"].round(2).astype(str) + "_" + df["lon"].round(2).astype(str)
    )
    df = df.sort_values(["month", "day_of_month", "hour", "minute"]).reset_index(drop=True)
    x = df[required_feature_cols].to_numpy(dtype=float)
    y = df["congestion_level"].to_numpy(dtype=float)
    return DatasetBundle(x=x, y=y, df=df, rows=len(df))


def _time_based_split(df: pd.DataFrame, train_ratio: float = 0.8) -> Tuple[pd.DataFrame, pd.DataFrame]:
    split_idx = int(len(df) * train_ratio)
    split_idx = max(1, min(split_idx, len(df) - 1))
    return df.iloc[:split_idx].copy(), df.iloc[split_idx:].copy()


def _build_features(df: pd.DataFrame) -> np.ndarray:
    cols = ["lat", "lon", "hour", "minute", "day_of_week", "day_of_month", "month"]
    return df[cols].to_numpy(dtype=float)


def _group_mae(df_eval: pd.DataFrame, col: str) -> Dict[str, float]:
    out = {}
    grouped = df_eval.groupby(col, dropna=True)
    for key, group in grouped:
        if len(group) == 0:
            continue
        out[str(key)] = round(mean_absolute_error(group["y_true"], group["y_pred"]), 4)
    return out


def train_and_save(csv_path: str, model_path: str, report_path: str = DEFAULT_REPORT_PATH) -> Tuple[float, float, int]:
    data = load_dataset(csv_path)
    train_df, test_df = _time_based_split(data.df, train_ratio=0.8)
    x_train = _build_features(train_df)
    y_train = train_df["congestion_level"].to_numpy(dtype=float)
    x_test = _build_features(test_df)
    y_test = test_df["congestion_level"].to_numpy(dtype=float)

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=14,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(x_train, y_train)

    preds = model.predict(x_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = mean_squared_error(y_test, preds) ** 0.5
    r2 = r2_score(y_test, preds)

    _ensure_parent_dir(model_path)
    with open(model_path, "wb") as f:
        pickle.dump(model, f)

    eval_df = test_df.copy()
    eval_df["y_true"] = y_test
    eval_df["y_pred"] = preds
    report = {
        "rows_total": int(data.rows),
        "rows_train": int(len(train_df)),
        "rows_test": int(len(test_df)),
        "split_strategy": "time_based_first_80pct_train_last_20pct_test",
        "metrics": {
            "mae": round(float(mae), 4),
            "rmse": round(float(rmse), 4),
            "r2": round(float(r2), 4),
        },
        "metrics_by_hour_mae": _group_mae(eval_df, "hour"),
        "metrics_by_zone_mae": _group_mae(eval_df, "zone_id"),
    }
    _ensure_parent_dir(report_path)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return mae, r2, data.rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Train congestion model from CSV data.")
    parser.add_argument("--data", default=DEFAULT_DATA_PATH, help="Path to CSV training data.")
    parser.add_argument("--out", default=DEFAULT_MODEL_PATH, help="Path to output .pkl model file.")
    parser.add_argument("--report", default=DEFAULT_REPORT_PATH, help="Path to evaluation report JSON.")
    args = parser.parse_args()

    mae, r2, rows = train_and_save(args.data, args.out, args.report)
    print(f"Training complete. rows={rows}, MAE={mae:.3f}, R2={r2:.3f}")
    print(f"Saved model to: {args.out}")
    print(f"Saved evaluation report to: {args.report}")
    print(f"Training data used: {args.data}")


if __name__ == "__main__":
    main()
