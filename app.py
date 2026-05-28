"""
Flask server for traffic congestion prediction API.
Provides /predict endpoint with model loading/reloading support.
"""

import logging
import math
import os
from datetime import datetime, timedelta

from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_cors import CORS
from model import get_model_status, predict_congestion, reload_model

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)


# Serve index.html at root
@app.route("/")
def root():
    return render_template("index.html")


# Serve static files (JS, CSS)
@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(app.static_folder, filename)


# Model configuration
MODEL_PATH = os.environ.get("MODEL_PATH", "models/congestion_model.pkl")

# Forecast sampling points around Haldia. Predictions still come from model.py.
FORECAST_POINTS = [
    {"lat": 22.0667, "lon": 88.0698},  # Haldia center
    {"lat": 22.0748, "lon": 88.0605},  # Near Durgachak
    {"lat": 22.0542, "lon": 88.0834},  # River-side stretch
    {"lat": 22.0841, "lon": 88.0746},  # Industrial belt side
    {"lat": 22.0438, "lon": 88.0587},  # Outskirts
]


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify(
        {
            "status": "healthy",
            "model_ready": True,  # Always True with fallback
            "model_status": get_model_status(),
        }
    )


@app.route("/predict", methods=["POST", "GET"])
def predict():
    """
    Predict traffic congestion at a given location and time.

    For POST: expects JSON body with lat, lon, timestamp
    For GET: expects query parameters lat, lon, timestamp OR hours for forecast window

    Returns:
        JSON with congestion prediction(s)
    """
    try:
        # Check for hours parameter (forecast window mode)
        if request.method == "POST":
            data = request.get_json() or {}
        else:
            data = request.args

        hours = data.get("hours")
        if hours is not None:
            # Forecast window mode - return multiple predictions
            return handle_time_window(hours)

        # Single prediction mode - validate required parameters
        required_fields = ["lat", "lon", "timestamp"]
        missing_fields = [field for field in required_fields if field not in data]

        if missing_fields:
            return jsonify(
                {"error": "Missing required parameters", "missing": missing_fields}
            ), 400

        # Extract parameters
        lat = float(data["lat"])
        lon = float(data["lon"])
        timestamp = data["timestamp"]

        # Validate coordinates
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return jsonify(
                {
                    "error": "Invalid coordinates",
                    "details": "lat must be between -90 and 90, lon between -180 and 180",
                }
            ), 400

        # Make prediction
        result = predict_congestion(lat, lon, timestamp)

        return jsonify({"success": True, "prediction": result})

    except ValueError as e:
        return jsonify({"error": "Invalid parameter format", "details": str(e)}), 400
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return jsonify({"error": "Prediction failed", "details": str(e)}), 500


def handle_time_window(hours):
    """Handle forecast window mode - return multiple predictions."""
    try:
        hours = int(hours)
    except ValueError:
        return jsonify({"error": "hours must be an integer"}), 400
    if hours <= 0:
        return jsonify({"error": "hours must be greater than 0"}), 400

    # Generate multiple predictions for the time window using real model inference.
    base_time = datetime.now()
    predictions = []

    # Build a meaningful time-series across the selected horizon.
    # Even for 1 hour, generate multiple points so the chart is a real line.
    num_predictions = max(6, min(hours * 2, 24))
    total_seconds = hours * 3600
    step_seconds = total_seconds / max(1, num_predictions - 1)

    for i in range(num_predictions):
        pred_time = base_time + timedelta(seconds=i * step_seconds)
        timestamp = pred_time.isoformat()
        point = FORECAST_POINTS[i % len(FORECAST_POINTS)]

        try:
            result = predict_congestion(point["lat"], point["lon"], timestamp)
        except Exception as e:
            logger.error(f"Forecast inference error at {timestamp}: {e}")
            continue

        predictions.append(
            {
                "location": {"latitude": point["lat"], "longitude": point["lon"]},
                "congestion_level": result["congestion_level"],
                "timestamp": timestamp,
                "confidence": result["confidence"],
                "predicted_speed": result["predicted_speed"],
                "model_used": result.get("model_used", "unknown"),
            }
        )

    if not predictions:
        return jsonify({"error": "No forecasts could be generated"}), 500

    return jsonify(
        {
            "success": True,
            "predictions": predictions,
            "forecast_hours": hours,
            "num_predictions": len(predictions),
        }
    )


@app.route("/predict-route", methods=["POST"])
def predict_route():
    """
    Predict congestion along a provided route polyline.

    Request JSON:
      - route_points: [{lat, lon}, ...] (min 2 points)
      - timestamp: optional ISO timestamp (default: now)
      - sample_count: optional int, default 24, clamped 2..120
    """
    try:
        data = request.get_json() or {}
        route_points = data.get("route_points")
        if not isinstance(route_points, list) or len(route_points) < 2:
            return jsonify(
                {"error": "route_points must be an array with at least 2 points"}
            ), 400

        timestamp = data.get("timestamp") or datetime.now().isoformat()
        sample_count = int(data.get("sample_count", 24))
        sample_count = max(2, min(sample_count, 120))
        route_distance_m = float(data.get("route_distance_m", 0) or 0)
        route_duration_s = float(data.get("route_duration_s", 0) or 0)

        sampled_points = _sample_route_points(route_points, sample_count)
        predictions = []
        for idx, p in enumerate(sampled_points):
            result = predict_congestion(p["lat"], p["lon"], timestamp)
            predictions.append(
                {
                    "index": idx,
                    "location": {"latitude": p["lat"], "longitude": p["lon"]},
                    "congestion_level": result["congestion_level"],
                    "predicted_speed": result["predicted_speed"],
                    "confidence": result["confidence"],
                    "timestamp": timestamp,
                    "model_used": result.get("model_used", "unknown"),
                }
            )

        levels = [p["congestion_level"] for p in predictions]
        avg_level = sum(levels) / len(levels)
        max_level = max(levels)
        min_level = min(levels)
        eta_summary = _estimate_route_eta(
            sampled_points, predictions, route_distance_m, route_duration_s
        )

        return jsonify(
            {
                "success": True,
                "route_predictions": predictions,
                "summary": {
                    "avg_congestion": round(avg_level, 2),
                    "max_congestion": round(max_level, 2),
                    "min_congestion": round(min_level, 2),
                    "num_samples": len(predictions),
                    "eta": eta_summary,
                },
            }
        )
    except ValueError as e:
        return jsonify({"error": "Invalid parameter format", "details": str(e)}), 400
    except Exception as e:
        logger.error(f"Route prediction error: {e}")
        return jsonify({"error": "Route prediction failed", "details": str(e)}), 500


@app.route("/predict-route-trend", methods=["POST"])
def predict_route_trend():
    """
    Predict route-level congestion trend across a future time window.

    Request JSON:
      - route_points: [{lat, lon}, ...] (min 2 points)
      - hours: optional int, default 1, clamped 1..24
      - num_predictions: optional int, default derived from hours, clamped 3..48
      - sample_count: optional int points sampled on route, default 24, clamped 2..120
    """
    try:
        data = request.get_json() or {}
        route_points = data.get("route_points")
        if not isinstance(route_points, list) or len(route_points) < 2:
            return jsonify(
                {"error": "route_points must be an array with at least 2 points"}
            ), 400

        hours = int(data.get("hours", 1))
        hours = max(1, min(hours, 24))
        sample_count = int(data.get("sample_count", 24))
        sample_count = max(2, min(sample_count, 120))
        default_num = max(6, min(hours * 2, 24))
        num_predictions = int(data.get("num_predictions", default_num))
        num_predictions = max(3, min(num_predictions, 48))

        sampled_points = _sample_route_points(route_points, sample_count)
        base_time = datetime.now()
        total_seconds = hours * 3600
        step_seconds = total_seconds / max(1, num_predictions - 1)
        trend = []

        for i in range(num_predictions):
            pred_time = base_time + timedelta(seconds=i * step_seconds)
            timestamp = pred_time.isoformat()
            point_predictions = []
            for p in sampled_points:
                result = predict_congestion(p["lat"], p["lon"], timestamp)
                point_predictions.append(result)

            levels = [x["congestion_level"] for x in point_predictions]
            speeds = [x["predicted_speed"] for x in point_predictions]
            confidences = [x["confidence"] for x in point_predictions]

            trend.append(
                {
                    "timestamp": timestamp,
                    "avg_congestion": round(sum(levels) / len(levels), 2),
                    "max_congestion": round(max(levels), 2),
                    "min_congestion": round(min(levels), 2),
                    "avg_speed": round(sum(speeds) / len(speeds), 2),
                    "avg_confidence": round(sum(confidences) / len(confidences), 2),
                    "num_route_samples": len(sampled_points),
                }
            )

        return jsonify(
            {
                "success": True,
                "forecast_hours": hours,
                "num_predictions": len(trend),
                "route_trend": trend,
            }
        )
    except ValueError as e:
        return jsonify({"error": "Invalid parameter format", "details": str(e)}), 400
    except Exception as e:
        logger.error(f"Route trend prediction error: {e}")
        return jsonify(
            {"error": "Route trend prediction failed", "details": str(e)}
        ), 500


def _sample_route_points(route_points, sample_count):
    """Return evenly spaced sampled points from the route."""
    cleaned = []
    for p in route_points:
        if not isinstance(p, dict) or "lat" not in p or "lon" not in p:
            raise ValueError("Each route point must include lat and lon.")
        lat = float(p["lat"])
        lon = float(p["lon"])
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            raise ValueError("Route point coordinates out of range.")
        cleaned.append({"lat": lat, "lon": lon})

    if sample_count >= len(cleaned):
        return cleaned

    max_index = len(cleaned) - 1
    picks = []
    for i in range(sample_count):
        idx = round(i * max_index / (sample_count - 1))
        picks.append(cleaned[idx])
    return picks


def _haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _estimate_route_eta(
    sampled_points, predictions, route_distance_m, route_duration_s
):
    # Segment-wise ETA using predicted speed from endpoint averages.
    if len(sampled_points) < 2:
        return {
            "raw_duration_seconds": int(route_duration_s)
            if route_duration_s > 0
            else 0,
            "ml_adjusted_duration_seconds": int(route_duration_s)
            if route_duration_s > 0
            else 0,
            "ml_adjustment_factor": 1.0,
        }

    predicted_seconds = 0.0
    for i in range(len(sampled_points) - 1):
        p1 = sampled_points[i]
        p2 = sampled_points[i + 1]
        d_m = _haversine_m(p1["lat"], p1["lon"], p2["lat"], p2["lon"])
        s1 = float(predictions[i]["predicted_speed"])
        s2 = float(predictions[i + 1]["predicted_speed"])
        speed_kmph = max(5.0, (s1 + s2) / 2.0)  # keep a minimum drivable speed
        speed_mps = speed_kmph * (1000.0 / 3600.0)
        predicted_seconds += d_m / speed_mps

    if route_distance_m > 0 and predicted_seconds > 0:
        # Scale sample-based ETA to OSRM route length.
        sampled_distance = 0.0
        for i in range(len(sampled_points) - 1):
            sampled_distance += _haversine_m(
                sampled_points[i]["lat"],
                sampled_points[i]["lon"],
                sampled_points[i + 1]["lat"],
                sampled_points[i + 1]["lon"],
            )
        if sampled_distance > 0:
            predicted_seconds *= route_distance_m / sampled_distance

    raw_seconds = route_duration_s if route_duration_s > 0 else predicted_seconds
    factor = (predicted_seconds / raw_seconds) if raw_seconds > 0 else 1.0
    factor = max(0.5, min(factor, 1.8))
    adjusted_seconds = raw_seconds * factor
    return {
        "raw_duration_seconds": int(round(raw_seconds)),
        "ml_adjusted_duration_seconds": int(round(adjusted_seconds)),
        "ml_adjustment_factor": round(float(factor), 3),
    }


@app.route("/reload", methods=["POST"])
def reload():
    """
    Reload the model from disk.

    Use this endpoint to reload the model after updating it.
    """
    try:
        if not reload_model():
            logger.warning("No trained model found, using dummy fallback")
        logger.info("Model reload attempted")
        return jsonify(
            {
                "success": True,
                "message": "Model reload completed",
                "model_status": get_model_status(),
            }
        )
    except Exception as e:
        logger.error(f"Failed to reload model: {e}")
        return jsonify({"error": "Failed to reload model", "details": str(e)}), 500


@app.route("/status", methods=["GET"])
def status():
    """Get current model status."""
    return jsonify({"model_ready": True, "model_status": get_model_status()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
