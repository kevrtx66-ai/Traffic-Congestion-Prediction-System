# Traffic Congestion Prediction - Backend API

This Flask-based API provides traffic congestion predictions using a machine learning model.

## Features

- `/predict` - Predict traffic congestion at a given location and time
- `/health` - Health check endpoint
- `/reload` - Reload the model (useful after model updates)
- `/status` - Get current model status

## Quick Start

### Installation

```bash
pip install -r requirements.txt
```

### Running the Server

```bash
python app.py
```

Or using gunicorn for production:

```bash
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Train the Model (CSV-based)

```bash
python train_model.py
```

Optional custom paths:

```bash
python train_model.py --data data/my_traffic_data.csv --out models/congestion_model.pkl
```

If the CSV is missing, a starter dataset is auto-generated at `data/traffic_training_data.csv` and used for training.

### Real Data Pipeline

Prepare model-ready training data from raw traffic records:

```bash
python data_pipeline.py --input data/raw/traffic_raw.csv --output data/traffic_training_data.csv
```

Supported raw input columns (flexible names accepted):
- Location: `lat/latitude`, `lon/lng/longitude`
- Time: `timestamp/datetime/time/event_time`
- Label: `congestion_level` (preferred) or speed (`speed_kmph/speed/avg_speed`) to derive congestion proxy
- Optional context: weather, holiday, event-day signals

Recommended flow:
1. Ingest raw data with `data_pipeline.py`
2. Train model with `train_model.py`
3. Serve predictions with `app.py`

## API Endpoints

### POST /predict
Predicts traffic congestion for a location and time.

**Request (JSON body or query params):**
- `lat` (float): Latitude
- `lon` (float): Longitude  
- `timestamp` (string): ISO format timestamp (e.g., "2024-01-15T14:30:00")

**Response:**
```json
{
  "success": true,
  "prediction": {
    "congestion_level": 3,
    "confidence": 0.82,
    "predicted_speed": 34.0,
    "features_used": {...}
  }
}
```

### GET /health
Returns server health status.

### POST /reload
Reloads the model from disk (useful after model updates).

### GET /status
Returns current model loading status.

### POST /predict-route
Predicts congestion along a route.

Request body:

```json
{
  "route_points": [
    { "lat": 22.06, "lon": 88.07 },
    { "lat": 22.07, "lon": 88.08 }
  ],
  "timestamp": "2026-05-26T14:30:00",
  "sample_count": 30
}
```

Response includes `route_predictions` (point-wise congestion) and summary (`avg_congestion`, `max_congestion`, `min_congestion`).

`summary.eta` includes:
- `raw_duration_seconds`: baseline route duration
- `ml_adjusted_duration_seconds`: segment-wise congestion-adjusted duration
- `ml_adjustment_factor`: ratio between ML ETA and baseline ETA

### POST /predict-route-trend
Predicts route-level congestion trend for a future time window.

Request body:

```json
{
  "route_points": [
    { "lat": 22.06, "lon": 88.07 },
    { "lat": 22.07, "lon": 88.08 }
  ],
  "hours": 6,
  "num_predictions": 12,
  "sample_count": 30
}
```

Response includes `route_trend` entries with `timestamp`, `avg_congestion`, `max_congestion`, `min_congestion`, `avg_speed`.

## Data Source

The model uses historical traffic data from multiple sources:
- **Traffic sensors** - Real-time congestion data from highway sensors
- **GPS traces** - Anonymized GPS traces from navigation apps
- **Weather data** - Weather conditions affecting traffic flow
- **Calendar data** - Holidays and special events

The model is trained on features including:
- Time of day (hour, minute)
- Day of week and month
- Geographic coordinates
- Historical traffic patterns

Supported CSV formats:
- Expanded features: `lat, lon, hour, minute, day_of_week, day_of_month, month, congestion_level`
- Timestamp format: `lat, lon, timestamp, congestion_level`

## Model Directory Structure

```
project/
├── app.py          # Flask server
├── model.py        # ML model module
├── requirements.txt # Python dependencies
├── models/
│   └── congestion_model.pkl  # Trained model (created by training pipeline)
└── data/
    ├── raw/        # Raw data
    └── processed/  # Processed features
```

## Configuration

Environment variables:
- `MODEL_PATH` - Path to the trained model file (default: 'models/congestion_model.pkl')
- `PORT` - Server port (default: 5000)
- `FLASK_DEBUG` - Enable debug mode (default: False)

## Integration with Frontend

The API is designed to be called from frontend applications. Example JavaScript usage:

```javascript
const response = await fetch('http://localhost:5000/predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lat: 40.7128,
    lon: -74.0060,
    timestamp: '2024-01-15T14:30:00'
  })
});
const data = await response.json();
console.log(data.prediction);
```

## Development

The model in `model.py` includes functions to:
- `reload_model()` - Force reload the model
- `predict_congestion(lat, lon, timestamp)` - Make predictions
- `get_model_status()` - Check model status

`train_model.py` now performs:
- Time-based split (first 80% train, last 20% test)
- Overall metrics: MAE, RMSE, R2
- Slice metrics: MAE by hour and by spatial zone
- Writes report JSON to `models/evaluation_report.json` (configurable via `--report`)
