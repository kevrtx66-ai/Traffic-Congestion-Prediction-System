"""
ML Model module for traffic congestion prediction.
Contains the predict_congestion function and model management utilities.
Supports loading a trained model from disk or using a dummy fallback model.
"""

import os
import pickle
import numpy as np
from datetime import datetime
from typing import Dict, Any, Optional
import logging
import random

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global model variable
_model: Optional[Any] = None
_fallback_model: Optional[Any] = None
_model_path: str = os.environ.get('MODEL_PATH', 'models/congestion_model.pkl')
_model_metadata: Dict[str, Any] = {
    'loaded': False,
    'path': _model_path,
    'last_loaded': None,
    'type': 'trained_model'
}

class DummyModel:
    """Simple dummy model for fallback when no trained model is available."""
    
    def __init__(self):
        self.base_congestion = 45
        self.variance = 15
        self.location_offsets = [
            {'lat': 22.0667, 'lon': 88.0698, 'offset': 0},
            {'lat': 22.0748, 'lon': 88.0605, 'offset': 10},
            {'lat': 22.0542, 'lon': 88.0834, 'offset': -5},
            {'lat': 22.0841, 'lon': 88.0746, 'offset': 15},
            {'lat': 22.0438, 'lon': 88.0587, 'offset': -10}
        ]
    
    def predict(self, features):
        """Generate a dummy prediction based on features."""
        lat = features[0][0]
        lon = features[0][1]
        hour = features[0][2]
        
        # Find closest location offset
        min_dist = float('inf')
        offset = 0
        for loc in self.location_offsets:
            dist = (lat - loc['lat'])**2 + (lon - loc['lon'])**2
            if dist < min_dist:
                min_dist = dist
                offset = loc['offset']
        
        # Generate prediction with randomness
        congestion = self.base_congestion + offset
        # Time-based variation (rush hour effect)
        if 7 <= hour <= 9 or 17 <= hour <= 19:
            congestion += 20  # Rush hour
        elif 12 <= hour <= 14:
            congestion += 10  # Lunch hour
        
        # Add noise
        congestion += random.randint(-self.variance, self.variance)
        
        return np.array([max(0, min(100, congestion))])
    
    def __str__(self):
        return "DummyModel(fallback)"


def get_model_status() -> Dict[str, Any]:
    """
    Get current model status information.
    
    Returns:
        Dictionary with model status details
    """
    return _model_metadata.copy()


def get_model():
    """
    Get the current model, loading one if necessary.
    Falls back to DummyModel if no trained model is available.
    
    Returns:
        The model object (trained or dummy)
    """
    global _model, _fallback_model
    
    # Try to load trained model if not already loaded
    if _model is None:
        if load_model():
            _model_metadata['type'] = 'trained_model'
            logger.info("Loaded trained model")
            return _model
    
    # Fall back to dummy model
    if _fallback_model is None:
        _fallback_model = DummyModel()
    
    _model_metadata['type'] = 'DummyModel (fallback)'
    return _fallback_model


def load_model() -> bool:
    """
    Load the trained model from disk.
    
    Returns:
        True if model loaded successfully, False otherwise
    """
    global _model
    
    if not os.path.exists(_model_path):
        logger.warning(f"Model file not found: {_model_path}")
        # Attempt to bootstrap a trained model from CSV before falling back.
        if _attempt_bootstrap_training():
            return load_model()
        _model_metadata['loaded'] = False
        return False
    
    try:
        with open(_model_path, 'rb') as f:
            _model = pickle.load(f)
        
        _model_metadata['loaded'] = True
        _model_metadata['last_loaded'] = datetime.now().isoformat()
        logger.info(f"Model loaded from {_model_path}")
        return True
        
    except Exception as e:
        logger.warning(f"Failed to load model from {_model_path}: {e}")
        _model_metadata['loaded'] = False
        return False


def reload_model() -> bool:
    """
    Force reload the model from disk.
    
    Returns:
        True if model reloaded successfully, False otherwise
    """
    return load_model()


def predict_congestion(lat: float, lon: float, timestamp: str) -> Dict[str, Any]:
    """
    Predict traffic congestion for a given location and time.
    Uses trained model if available, otherwise falls back to dummy model.
    
    Args:
        lat: Latitude of the location
        lon: Longitude of the location
        timestamp: ISO format timestamp string (e.g., "2024-01-15T14:30:00")
    
    Returns:
        Dictionary containing:
            - congestion_level: Predicted congestion level (0-100 scale)
            - confidence: Model confidence (0-1)
            - predicted_speed: Estimated average speed in km/h
            - features_used: Input features for interpretability
    
    Raises:
        ValueError: If parameters are invalid
    """
    # Get model (either trained or fallback)
    model = get_model()
    
    # Parse timestamp
    try:
        dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError(f"Invalid timestamp format: {timestamp}")
    
    # Extract time features
    hour = dt.hour
    minute = dt.minute
    day_of_week = dt.weekday()  # 0=Monday, 6=Sunday
    day_of_month = dt.day
    month = dt.month
    
    # Create feature vector
    features = np.array([[lat, lon, hour, minute, day_of_week, day_of_month, month]])
    
    # Make prediction
    congestion_raw = model.predict(features)[0]
    
    # Get confidence based on model type
    is_trained = _model is not None
    confidence = 0.75 if is_trained else 0.65
    
    # Estimate speed based on congestion (inverse relationship)
    base_speed = 60  # km/h baseline
    predicted_speed = max(0, base_speed - (congestion_raw * 0.5))
    
    return {
        'congestion_level': float(congestion_raw),
        'confidence': round(confidence, 2),
        'predicted_speed': round(predicted_speed, 1),
        'features_used': {
            'lat': lat,
            'lon': lon,
            'hour': hour,
            'day_of_week': day_of_week,
            'month': month
        },
        'model_used': _model_metadata['type']
    }


def validate_features(lat: float, lon: float) -> bool:
    """
    Validate that the input coordinates are within valid ranges.
    
    Args:
        lat: Latitude to validate
        lon: Longitude to validate
    
    Returns:
        True if coordinates are valid, False otherwise
    """
    return -90 <= lat <= 90 and -180 <= lon <= 180


# Initialize on module load
def _attempt_bootstrap_training() -> bool:
    """Try creating a trained model artifact automatically from CSV data."""
    try:
        from train_model import train_and_save, DEFAULT_DATA_PATH
    except Exception as e:
        logger.warning(f"Training bootstrap import failed: {e}")
        return False

    try:
        mae, r2, rows = train_and_save(DEFAULT_DATA_PATH, _model_path)
        logger.info(
            "Auto-trained model created at %s (rows=%s, MAE=%.3f, R2=%.3f)",
            _model_path,
            rows,
            mae,
            r2,
        )
        return True
    except Exception as e:
        logger.warning(f"Training bootstrap failed: {e}")
        return False


def initialize():
    """Initialize the model when the module is loaded."""
    if not load_model():
        logger.info("No trained model found, using dummy fallback model for predictions.")


# Run initialization
initialize()
