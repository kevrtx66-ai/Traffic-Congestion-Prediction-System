export function formatTimeLabel(isoTimestamp) {
	return new Date(isoTimestamp).toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function formatDateTime(isoTimestamp) {
	return new Date(isoTimestamp).toLocaleString();
}

export function formatDurationMinutes(totalMinutes) {
	if (totalMinutes < 60) return `${totalMinutes} min`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function formatDurationSeconds(totalSeconds) {
	if (totalSeconds <= 30) return '<1 min';
	const minutes = Math.max(1, Math.round(totalSeconds / 60));
	return formatDurationMinutes(minutes);
}

export function formatFactor(value) {
	if (!Number.isFinite(value)) return 'N/A';
	return `${value.toFixed(2)}x`;
}
