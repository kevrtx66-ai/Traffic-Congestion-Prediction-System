"""
Data ingestion and feature engineering pipeline for real traffic data.

Builds model-ready CSV from raw records.

Usage:
  python data_pipeline.py --input data/raw/traffic_raw.csv --output data/traffic_training_data.csv
"""

import argparse
import os
from typing import List

import pandas as pd


DEFAULT_INPUT_PATH = "data/raw/traffic_raw.csv"
DEFAULT_OUTPUT_PATH = "data/traffic_training_data.csv"


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _find_first_col(columns: List[str], candidates: List[str]) -> str:
    lower_map = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand in lower_map:
            return lower_map[cand]
    return ""


def build_training_dataset(input_path: str, output_path: str) -> int:
    df = pd.read_csv(input_path)
    if df.empty:
        raise ValueError("Input raw CSV is empty.")

    lat_col = _find_first_col(df.columns.tolist(), ["lat", "latitude"])
    lon_col = _find_first_col(df.columns.tolist(), ["lon", "lng", "longitude"])
    ts_col = _find_first_col(df.columns.tolist(), ["timestamp", "datetime", "time", "event_time"])
    congestion_col = _find_first_col(
        df.columns.tolist(),
        ["congestion_level", "congestion", "traffic_index", "jam_factor"]
    )
    speed_col = _find_first_col(df.columns.tolist(), ["speed_kmph", "speed", "avg_speed"])

    if not lat_col or not lon_col or not ts_col:
        raise ValueError("Raw CSV must provide location and time columns (lat/lon/timestamp).")

    if not congestion_col and not speed_col:
        raise ValueError("Raw CSV must include congestion label column or speed column.")

    out = pd.DataFrame()
    out["lat"] = pd.to_numeric(df[lat_col], errors="coerce")
    out["lon"] = pd.to_numeric(df[lon_col], errors="coerce")
    ts = pd.to_datetime(df[ts_col], errors="coerce")
    out["timestamp"] = ts
    out["hour"] = ts.dt.hour
    out["minute"] = ts.dt.minute
    out["day_of_week"] = ts.dt.weekday
    out["day_of_month"] = ts.dt.day
    out["month"] = ts.dt.month

    if congestion_col:
        out["congestion_level"] = pd.to_numeric(df[congestion_col], errors="coerce")
    else:
        # Convert speed to congestion proxy if needed.
        speed = pd.to_numeric(df[speed_col], errors="coerce")
        out["congestion_level"] = (100 - (speed.clip(lower=0, upper=80) / 80.0) * 100).clip(0, 100)

    # Optional useful features (kept for future model upgrades)
    weather_col = _find_first_col(df.columns.tolist(), ["weather_code", "rain_mm", "precip_mm"])
    holiday_col = _find_first_col(df.columns.tolist(), ["is_holiday", "holiday"])
    event_col = _find_first_col(df.columns.tolist(), ["is_event_day", "event_day"])
    if weather_col:
        out["weather_signal"] = pd.to_numeric(df[weather_col], errors="coerce").fillna(0)
    if holiday_col:
        out["is_holiday"] = pd.to_numeric(df[holiday_col], errors="coerce").fillna(0).clip(0, 1)
    if event_col:
        out["is_event_day"] = pd.to_numeric(df[event_col], errors="coerce").fillna(0).clip(0, 1)

    out = out.dropna(subset=["lat", "lon", "timestamp", "congestion_level"])
    out["congestion_level"] = out["congestion_level"].clip(0, 100)

    _ensure_parent_dir(output_path)
    out.to_csv(output_path, index=False)
    return len(out)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare training dataset from raw traffic CSV.")
    parser.add_argument("--input", default=DEFAULT_INPUT_PATH, help="Path to raw input CSV.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH, help="Path to output training CSV.")
    args = parser.parse_args()

    rows = build_training_dataset(args.input, args.output)
    print(f"Prepared {rows} rows at {args.output}")


if __name__ == "__main__":
    main()

