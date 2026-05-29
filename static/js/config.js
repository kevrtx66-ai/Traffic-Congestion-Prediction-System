export const DEFAULT_MAP_VIEW = {
	lat: 22.0667,
	lon: 88.0698,
	zoom: 12
};

export const TILE_LAYER_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const CONGESTION_THRESHOLDS = {
	low: 30,
	medium: 60,
	high: 75
};

export const CONGESTION_COLORS = {
	low: '#2fbf71',
	medium: '#f59e0b',
	high: '#e34b4b'
};

export const ROUTE_SAMPLE_COUNT = 30;
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const HOTSPOT_MIN_DISTANCE_M = 220;
export const HOTSPOT_MAX_MARKERS = 10;
