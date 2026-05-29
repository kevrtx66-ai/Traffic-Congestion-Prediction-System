import { HOTSPOT_MAX_MARKERS, HOTSPOT_MIN_DISTANCE_M } from '../config.js';
import { getCongestionStatus } from './congestion.js';

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(a, b) {
	const p1 = (a.lat * Math.PI) / 180;
	const p2 = (b.lat * Math.PI) / 180;
	const dLat = ((b.lat - a.lat) * Math.PI) / 180;
	const dLon = ((b.lon - a.lon) * Math.PI) / 180;
	const x =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

function pointToVector(a, b) {
	return { x: b.lon - a.lon, y: b.lat - a.lat };
}

function angleAtPoint(prev, current, next) {
	const v1 = pointToVector(current, prev);
	const v2 = pointToVector(current, next);
	const dot = v1.x * v2.x + v1.y * v2.y;
	const mag1 = Math.hypot(v1.x, v1.y);
	const mag2 = Math.hypot(v2.x, v2.y);
	if (!mag1 || !mag2) return 0;
	const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
	return Math.acos(cosTheta) * (180 / Math.PI);
}

function toPredictionPoint(prediction) {
	return {
		lat: prediction.location.latitude,
		lon: prediction.location.longitude
	};
}

export function buildCongestionSegments(routePredictions, etaFactor = 1) {
	if (!Array.isArray(routePredictions) || routePredictions.length < 2) return [];

	const segments = [];
	for (let i = 0; i < routePredictions.length - 1; i += 1) {
		const p1 = routePredictions[i];
		const p2 = routePredictions[i + 1];
		const start = toPredictionPoint(p1);
		const end = toPredictionPoint(p2);

		const congestion = (p1.congestion_level + p2.congestion_level) / 2;
		const speedKmph = Math.max(5, (p1.predicted_speed + p2.predicted_speed) / 2);
		const distanceM = haversineMeters(start, end);
		const speedMps = speedKmph * (1000 / 3600);
		const predictedSeconds = distanceM / speedMps;

		const baselineKmph = Math.max(28, speedKmph + 14);
		const baselineMps = baselineKmph * (1000 / 3600);
		const baselineSeconds = distanceM / baselineMps;
		const delaySeconds = Math.max(0, predictedSeconds - baselineSeconds);

		segments.push({
			coords: [
				[start.lat, start.lon],
				[end.lat, end.lon]
			],
			congestion,
			speedKmph,
			delaySeconds,
			etaFactor,
			status: getCongestionStatus(congestion)
		});
	}
	return segments;
}

export function selectHotspotIndices(routePredictions) {
	if (!Array.isArray(routePredictions) || routePredictions.length === 0) return [];

	const selected = new Set();
	const bySeverity = [...routePredictions]
		.map((prediction, index) => ({ index, value: prediction.congestion_level }))
		.sort((a, b) => b.value - a.value);

	bySeverity.slice(0, 4).forEach((entry) => selected.add(entry.index));

	routePredictions.forEach((prediction, index) => {
		if (prediction.congestion_level >= 70) selected.add(index);
	});

	for (let i = 1; i < routePredictions.length - 1; i += 1) {
		const prev = toPredictionPoint(routePredictions[i - 1]);
		const current = toPredictionPoint(routePredictions[i]);
		const next = toPredictionPoint(routePredictions[i + 1]);
		const turnAngle = angleAtPoint(prev, current, next);
		if (turnAngle <= 125 && routePredictions[i].congestion_level >= 35) {
			selected.add(i);
		}
	}

	const sorted = Array.from(selected).sort((a, b) => a - b);
	const pruned = [];
	for (const idx of sorted) {
		const current = toPredictionPoint(routePredictions[idx]);
		const tooClose = pruned.some((chosenIdx) => {
			const chosen = toPredictionPoint(routePredictions[chosenIdx]);
			return haversineMeters(current, chosen) < HOTSPOT_MIN_DISTANCE_M;
		});
		if (!tooClose) pruned.push(idx);
		if (pruned.length >= HOTSPOT_MAX_MARKERS) break;
	}

	return pruned;
}
