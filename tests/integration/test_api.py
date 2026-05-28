import json
import pytest
import datetime as dt
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app


@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


class TestAPIEndpoints:
    """Integration tests for backend API endpoints."""

    def test_health_endpoint_returns_ok(self, client):
        """Test that /health returns 200 OK with correct message."""
        response = client.get('/health')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'healthy'
        assert 'model_ready' in data
        assert 'model_status' in data

    def test_predict_valid_request(self, client):
        """Test prediction endpoint with valid input."""
        request_data = {
            'lat': 40.7128,
            'lon': -74.0060,
            'timestamp': dt.datetime.now().isoformat()
        }

        response = client.post(
            '/predict',
            data=json.dumps(request_data),
            content_type='application/json'
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'prediction' in data
        assert 'congestion_level' in data['prediction']
        assert 'confidence' in data['prediction']

    def test_predict_missing_fields(self, client):
        """Test prediction endpoint rejects missing fields."""
        request_data = {
            'lat': 40.7128,
            # Missing lon and timestamp
        }

        response = client.post(
            '/predict',
            data=json.dumps(request_data),
            content_type='application/json'
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data

    def test_predict_invalid_coordinates(self, client):
        """Test prediction endpoint rejects invalid coordinates."""
        request_data = {
            'lat': 91.0,  # Invalid latitude (out of range)
            'lon': -74.0060,
            'timestamp': dt.datetime.now().isoformat()
        }

        response = client.post(
            '/predict',
            data=json.dumps(request_data),
            content_type='application/json'
        )

        assert response.status_code == 400

    def test_predict_invalid_timestamp(self, client):
        """Test prediction endpoint rejects invalid timestamp."""
        request_data = {
            'lat': 40.7128,
            'lon': -74.0060,
            'timestamp': 'not-a-datetime'
        }

        response = client.post(
            '/predict',
            data=json.dumps(request_data),
            content_type='application/json'
        )

        assert response.status_code == 400
