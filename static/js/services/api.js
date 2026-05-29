async function parseResponse(response) {
	if (!response.ok) {
		throw new Error(`Request failed (${response.status})`);
	}
	return response.json();
}

export async function fetchForecast(hours) {
	const response = await fetch(`/predict?hours=${hours}`);
	const data = await parseResponse(response);
	if (!data.success || !Array.isArray(data.predictions)) {
		throw new Error(data.error || 'Invalid forecast response');
	}
	return data;
}

export async function fetchRoutePrediction(payload) {
	const response = await fetch('/predict-route', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const data = await parseResponse(response);
	if (!data.success || !Array.isArray(data.route_predictions)) {
		throw new Error(data.error || 'Invalid route prediction response');
	}
	return data;
}

export async function fetchRouteTrend(payload) {
	const response = await fetch('/predict-route-trend', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const data = await parseResponse(response);
	if (!data.success || !Array.isArray(data.route_trend)) {
		throw new Error(data.error || 'Invalid route trend response');
	}
	return data;
}
