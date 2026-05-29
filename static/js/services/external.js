async function fetchJsonOrThrow(url, options) {
	const response = await fetch(url, options);
	if (!response.ok) {
		throw new Error(`External request failed (${response.status})`);
	}
	return response.json();
}

export async function geocodePlace(query) {
	const endpoint = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
	const results = await fetchJsonOrThrow(endpoint, {
		headers: { Accept: 'application/json' }
	});
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error(`No location found for "${query}"`);
	}
	const lat = parseFloat(results[0].lat);
	const lon = parseFloat(results[0].lon);
	if (Number.isNaN(lat) || Number.isNaN(lon)) {
		throw new Error('Location lookup returned invalid coordinates');
	}
	return { lat, lon };
}

export async function fetchAlternativeRoutes(startPoint, endPoint) {
	const url = `https://router.project-osrm.org/route/v1/driving/${startPoint.lon},${startPoint.lat};${endPoint.lon},${endPoint.lat}?alternatives=true&overview=full&geometries=geojson&steps=false`;
	const data = await fetchJsonOrThrow(url);
	if (!Array.isArray(data.routes) || data.routes.length === 0) {
		throw new Error('No route found for selected points');
	}
	return data.routes;
}
