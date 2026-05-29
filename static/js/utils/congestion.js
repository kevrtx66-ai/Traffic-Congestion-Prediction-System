import { CONGESTION_COLORS, CONGESTION_THRESHOLDS } from '../config.js';

export function getCongestionStatus(level) {
	if (level < CONGESTION_THRESHOLDS.low) return 'Low';
	if (level < CONGESTION_THRESHOLDS.medium) return 'Medium';
	return 'High';
}

export function getCongestionColor(level) {
	if (level < CONGESTION_THRESHOLDS.low) return CONGESTION_COLORS.low;
	if (level < CONGESTION_THRESHOLDS.medium) return CONGESTION_COLORS.medium;
	return CONGESTION_COLORS.high;
}
