let map;
let congestionChart;
let congestionLayer;
let lastUpdateTime = null;
let isFetching = false;
let routeLayers = [];
let routeCongestionLayers = [];
let routeData = [];
let routeInsights = [];
let selectedRouteIndex = 0;
let startMarker = null;
let endMarker = null;
let routeSelectionMode = null;
let userLocationMarker = null;

document.addEventListener('DOMContentLoaded', function() {
	initializeMap();
	initializeChart();
	setupEventListeners();
	setupChartPanelToggle();
	fetchCongestionData();
	startAutoRefresh();
});

function initializeMap() {
	map = L.map('map').setView([22.0667, 88.0698], 12);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '© OpenStreetMap contributors',
		maxZoom: 19
	}).addTo(map);
	addLegend();
	map.on('click', handleMapClickForRoute);
}

function addLegend() {
	const legend = L.control({ position: 'bottomright' });
	legend.onAdd = function(map) {
		const div = L.DomUtil.create('div', 'leaflet-control-legend');
		div.innerHTML = `
			<h4>Congestion Levels</h4>
			<div class="legend-item">
				<div class="legend-color" style="background: #2ecc71;"></div>
				<span>Low (0-30%)</span>
			</div>
			<div class="legend-item">
				<div class="legend-color" style="background: #f39c12;"></div>
				<span>Medium (30-60%)</span>
			</div>
			<div class="legend-item">
				<div class="legend-color" style="background: #e74c3c;"></div>
				<span>High (60-100%)</span>
			</div>
		`;
		return div;
	};
	legend.addTo(map);
}

function initializeChart() {
	const ctx = document.getElementById('congestion-chart').getContext('2d');
	congestionChart = new Chart(ctx, {
		type: 'line',
		data: {
			labels: [],
			datasets: [{
				label: 'Average Congestion (%)',
				data: [],
				borderColor: 'rgb(75, 192, 192)',
				backgroundColor: 'rgba(75, 192, 192, 0.2)',
				tension: 0.1
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
					max: 100,
					title: {
						display: true,
						text: 'Congestion (%)'
					}
				},
				x: {
					title: {
						display: true,
						text: 'Time'
					}
				}
			}
		}
	});
}

function setupEventListeners() {
	document.getElementById('refresh-btn').addEventListener('click', fetchCongestionData);
	document.getElementById('time-window').addEventListener('change', fetchCongestionData);
	document.getElementById('locate-me-btn').addEventListener('click', detectUserLocation);
	document.getElementById('set-start-btn').addEventListener('click', () => {
		routeSelectionMode = 'start';
		setRouteStatus('Route: click map to set start point.');
	});
	document.getElementById('set-end-btn').addEventListener('click', () => {
		routeSelectionMode = 'end';
		setRouteStatus('Route: click map to set destination point.');
	});
	document.getElementById('draw-route-btn').addEventListener('click', drawShortestRoute);
	document.getElementById('clear-route-btn').addEventListener('click', clearRoute);
	document.getElementById('find-start-btn').addEventListener('click', async () => {
		await findPlaceAndSetPoint('start');
	});
	document.getElementById('find-end-btn').addEventListener('click', async () => {
		await findPlaceAndSetPoint('end');
	});
	document.getElementById('close-route-panel-btn').addEventListener('click', closeRoutePanel);
}

function setupChartPanelToggle() {
	const chartContainer = document.getElementById('chart-container');
	const toggleButton = document.getElementById('toggle-chart-size-btn');
	toggleButton.addEventListener('click', () => {
		const isExpanded = chartContainer.classList.toggle('chart-expanded');
		toggleButton.textContent = isExpanded ? 'Minimize' : 'Expand';
		toggleButton.setAttribute('aria-expanded', String(isExpanded));
		setTimeout(() => {
			if (congestionChart) {
				congestionChart.resize();
			}
			if (map) {
				map.invalidateSize();
			}
		}, 200);
	});
}

async function fetchCongestionData() {
	if (isFetching) return;
	isFetching = true;
	const timeWindow = document.getElementById('time-window').value;
	const refreshButton = document.getElementById('refresh-btn');
	try {
		document.getElementById('update-status').textContent = 'Fetching data...';
		refreshButton.disabled = true;
		refreshButton.textContent = 'Loading...';
		const response = await fetch(`/predict?hours=${timeWindow}`);
		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
		const data = await response.json();
		if (!data.success || !Array.isArray(data.predictions)) {
			throw new Error(data.error || 'Invalid prediction payload from server');
		}
		updateCongestionMap(data.predictions);
		if (hasActiveRoute()) {
			await updateChartForSelectedRoute(Number(timeWindow));
		} else {
			updateChart(data.predictions);
		}
		lastUpdateTime = new Date();
		document.getElementById('update-status').textContent = `Last updated: ${lastUpdateTime.toLocaleString()}`;
	} catch (error) {
		console.error('Error fetching congestion data:', error);
		document.getElementById('update-status').textContent = `Error: ${error.message}`;
	} finally {
		isFetching = false;
		refreshButton.disabled = false;
		refreshButton.textContent = 'Refresh Data';
	}
}

function hasActiveRoute() {
	return routeData.length > 0 && routeData[selectedRouteIndex] && routeData[selectedRouteIndex].geometry;
}

function updateCongestionMap(predictions) {
	if (congestionLayer) map.removeLayer(congestionLayer);
	const features = predictions.map(prediction => ({
		type: 'Feature',
		geometry: {
			type: 'Point',
			coordinates: [prediction.location.longitude, prediction.location.latitude]
		},
		properties: {
			congestion: prediction.congestion_level,
			timestamp: prediction.timestamp
		}
	}));
	congestionLayer = L.geoJSON(features, {
		pointToLayer: function(feature, latlng) {
			const congestion = feature.properties.congestion;
			const color = getCongestionColor(congestion);
			return L.circleMarker(latlng, {
				radius: 8 + (congestion / 100) * 12,
				fillColor: color,
				color: '#fff',
				weight: 2,
				opacity: 1,
				fillOpacity: 0.7
			});
		},
		onEachFeature: function(feature, layer) {
			const congestion = feature.properties.congestion;
			const timestamp = new Date(feature.properties.timestamp);
			layer.bindPopup(`
				<h4>Congestion Information</h4>
				<p><strong>Level:</strong> ${congestion.toFixed(1)}%</p>
				<p><strong>Status:</strong> ${getCongestionStatus(congestion)}</p>
				<p><strong>Time:</strong> ${timestamp.toLocaleString()}</p>
			`);
		}
	}).addTo(map);
	if (features.length > 0) {
		const bounds = L.latLngBounds(features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]));
		map.fitBounds(bounds, { padding: [50, 50] });
	}
}

function updateChart(predictions) {
	const sortedPredictions = [...predictions].sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
	);
	const labels = sortedPredictions.map((prediction) => {
		const ts = new Date(prediction.timestamp);
		return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	});
	const data = sortedPredictions.map((prediction) => prediction.congestion_level);
	congestionChart.data.labels = labels;
	congestionChart.data.datasets[0].data = data;
	congestionChart.data.datasets[0].label = 'Average Congestion (%)';
	congestionChart.update();
}

function getCongestionColor(congestion) {
	if (congestion < 30) return '#2ecc71';
	if (congestion < 60) return '#f39c12';
	return '#e74c3c';
}

function getCongestionStatus(congestion) {
	if (congestion < 30) return 'Low';
	if (congestion < 60) return 'Medium';
	return 'High';
}

function startAutoRefresh() {
	setInterval(fetchCongestionData, 5 * 60 * 1000);
}

function handleMapClickForRoute(event) {
	if (!routeSelectionMode) return;
	const lat = Number(event.latlng.lat.toFixed(6));
	const lon = Number(event.latlng.lng.toFixed(6));
	if (routeSelectionMode === 'start') {
		setStartPoint(lat, lon);
		setRouteStatus('Route: start set. Click "Set Destination" then click map.');
	} else if (routeSelectionMode === 'end') {
		setEndPoint(lat, lon);
		setRouteStatus('Route: destination set. Click "Show Shortest Route".');
	}
	routeSelectionMode = null;
}

function setStartPoint(lat, lon) {
	if (startMarker) map.removeLayer(startMarker);
	startMarker = L.marker([lat, lon], { title: 'Start' }).addTo(map).bindPopup('Start');
	startMarker.startLat = lat;
	startMarker.startLon = lon;
}

function setEndPoint(lat, lon) {
	if (endMarker) map.removeLayer(endMarker);
	endMarker = L.marker([lat, lon], { title: 'Destination' }).addTo(map).bindPopup('Destination');
	endMarker.endLat = lat;
	endMarker.endLon = lon;
}

function readRouteInputs() {
	if (!startMarker || !endMarker) {
		throw new Error('Please set start and destination points first.');
	}
	const startCoords = startMarker.getLatLng();
	const endCoords = endMarker.getLatLng();
	const startLat = startCoords.lat;
	const startLon = startCoords.lng;
	const endLat = endCoords.lat;
	const endLon = endCoords.lng;
	if (Math.abs(startLat) > 90 || Math.abs(endLat) > 90 || Math.abs(startLon) > 180 || Math.abs(endLon) > 180) {
		throw new Error('Invalid coordinates for start or destination.');
	}
	return { startLat, startLon, endLat, endLon };
}

async function findPlaceAndSetPoint(type) {
	try {
		const inputId = type === 'start' ? 'start-place' : 'end-place';
		const query = document.getElementById(inputId).value.trim();
		if (!query) {
			throw new Error(`Please enter a ${type === 'start' ? 'start' : 'destination'} location name.`);
		}
		setRouteStatus(`Route: finding ${type} location...`);
		const location = await geocodePlace(query);
		if (type === 'start') {
			setStartPoint(location.lat, location.lon);
			setRouteStatus('Route: start location set. Now set destination.');
		} else {
			setEndPoint(location.lat, location.lon);
			setRouteStatus('Route: destination location set. Click "Show Shortest Route".');
		}
		map.setView([location.lat, location.lon], 13);
	} catch (error) {
		console.error('Geocoding error:', error);
		setRouteStatus(`Route error: ${error.message}`);
	}
}

async function geocodePlace(query) {
	const endpoint = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
	const response = await fetch(endpoint, {
		headers: {
			'Accept': 'application/json'
		}
	});
	if (!response.ok) {
		throw new Error(`Location lookup failed (${response.status})`);
	}
	const results = await response.json();
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error(`No location found for "${query}"`);
	}
	const lat = parseFloat(results[0].lat);
	const lon = parseFloat(results[0].lon);
	if (Number.isNaN(lat) || Number.isNaN(lon)) {
		throw new Error('Location lookup returned invalid coordinates.');
	}
	return { lat, lon };
}

async function drawShortestRoute() {
	try {
		setRouteStatus('Route: fetching shortest path...');
		const { startLat, startLon, endLat, endLon } = readRouteInputs();
		const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?alternatives=true&overview=full&geometries=geojson&steps=false`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Routing API error (${response.status})`);
		const data = await response.json();
		if (!data.routes || data.routes.length === 0) throw new Error('No route found for selected points.');
		routeData = data.routes;
		routeInsights = new Array(routeData.length).fill(null);
		selectedRouteIndex = 0;
		renderAlternativeRoutes();
		await loadRouteInsights();
		renderRoutePanel();
		openRoutePanel();
		setRouteStatus(routeSummaryMessage(routeData[0], 0));
		await fetchAndRenderRouteCongestion();
	} catch (error) {
		console.error('Route drawing error:', error);
		setRouteStatus(`Route error: ${error.message}`);
	}
}

function clearRoute() {
	clearRenderedRoutes();
	clearRouteCongestionLayers();
	if (startMarker) map.removeLayer(startMarker);
	if (endMarker) map.removeLayer(endMarker);
	routeData = [];
	routeInsights = [];
	startMarker = null;
	endMarker = null;
	routeSelectionMode = null;
	document.getElementById('start-place').value = '';
	document.getElementById('end-place').value = '';
	closeRoutePanel();
	setRouteStatus('Route: cleared. Click "Set Start" then click map.');
}

function setRouteStatus(message) {
	document.getElementById('route-status').textContent = message;
}

function clearRenderedRoutes() {
	routeLayers.forEach((layer) => map.removeLayer(layer));
	routeLayers = [];
}

function clearRouteCongestionLayers() {
	routeCongestionLayers.forEach((layer) => map.removeLayer(layer));
	routeCongestionLayers = [];
}

function renderAlternativeRoutes() {
	clearRenderedRoutes();
	routeLayers = routeData.map((route, index) => {
		const isPrimary = index === selectedRouteIndex;
		const layer = L.geoJSON(route.geometry, {
			style: {
				color: isPrimary ? '#1d4ed8' : '#6aa5ff',
				weight: isPrimary ? 6 : 4,
				opacity: isPrimary ? 0.95 : 0.6
			}
		}).addTo(map);
		layer.on('click', () => selectRoute(index));
		return layer;
	});
	if (routeLayers.length > 0) {
		map.fitBounds(routeLayers[selectedRouteIndex].getBounds(), { padding: [40, 40] });
	}
}

function routeSummaryMessage(route, index) {
	const km = (route.distance / 1000).toFixed(2);
	const rawMinutes = Math.round(route.duration / 60);
	const rawDurationLabel = formatDurationMinutes(rawMinutes);
	const insight = routeInsights[index];
	const mlSeconds = insight?.eta?.ml_adjusted_duration_seconds || Math.round(route.duration);
	const mlDurationLabel = formatDurationMinutes(Math.max(1, Math.round(mlSeconds / 60)));
	const label = index === 0 ? 'Best route' : `Alternative ${index}`;
	return `Route: ${label} ${km} km, Raw ETA ${rawDurationLabel}, ML ETA ${mlDurationLabel}.`;
}

function renderRoutePanel() {
	const routeList = document.getElementById('route-list');
	routeList.innerHTML = '';
	routeData.forEach((route, index) => {
		const km = (route.distance / 1000).toFixed(2);
		const rawMinutes = Math.round(route.duration / 60);
		const rawDurationLabel = formatDurationMinutes(rawMinutes);
		const insight = routeInsights[index];
		const mlSeconds = insight?.eta?.ml_adjusted_duration_seconds || Math.round(route.duration);
		const mlDurationLabel = formatDurationMinutes(Math.max(1, Math.round(mlSeconds / 60)));
		const factor = insight?.eta?.ml_adjustment_factor;
		const factorText = typeof factor === 'number' ? `${factor.toFixed(2)}x` : 'Pending';
		const card = document.createElement('button');
		card.type = 'button';
		card.className = `route-card ${index === selectedRouteIndex ? 'active' : ''}`;
		card.innerHTML = `
			<div class="route-card-top">
				<span class="route-title">${index === 0 ? 'Best Route' : `Alternative ${index}`}</span>
				<span class="route-tag">Estimated Time</span>
			</div>
			<div class="route-card-meta">${km} km</div>
			<div class="route-card-foot">Raw ETA: ${rawDurationLabel}</div>
			<div class="route-card-foot">ML ETA: ${mlDurationLabel}</div>
			<div class="route-card-foot">ML adjustment factor: ${factorText}</div>
		`;
		card.addEventListener('click', () => selectRoute(index));
		routeList.appendChild(card);
	});
}

function formatDurationMinutes(totalMinutes) {
	if (totalMinutes < 60) return `${totalMinutes} min`;
	const hours = Math.floor(totalMinutes / 60);
	const remainingMinutes = totalMinutes % 60;
	if (remainingMinutes === 0) return `${hours} hr`;
	return `${hours} hr ${remainingMinutes} min`;
}

function selectRoute(index) {
	selectedRouteIndex = index;
	renderAlternativeRoutes();
	renderRoutePanel();
	setRouteStatus(routeSummaryMessage(routeData[index], index));
	fetchAndRenderRouteCongestion();
}

async function fetchAndRenderRouteCongestion() {
	try {
		if (!routeData.length || !routeData[selectedRouteIndex]) return;
		const route = routeData[selectedRouteIndex];
		const coords = route.geometry?.coordinates || [];
		if (coords.length < 2) return;

		setRouteStatus(`${routeSummaryMessage(route, selectedRouteIndex)} Predicting route congestion...`);

		const routePoints = coords.map(([lon, lat]) => ({ lat, lon }));
		const response = await fetch('/predict-route', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				route_points: routePoints,
				timestamp: new Date().toISOString(),
				sample_count: 30,
				route_distance_m: route.distance,
				route_duration_s: route.duration
			})
		});

		if (!response.ok) throw new Error(`Route congestion API error (${response.status})`);
		const data = await response.json();
		if (!data.success || !Array.isArray(data.route_predictions)) {
			throw new Error(data.error || 'Invalid route congestion payload');
		}

		routeInsights[selectedRouteIndex] = data.summary || null;
		renderRouteCongestion(data.route_predictions);
		const summary = routeInsights[selectedRouteIndex] || {};
		setRouteStatus(
			`${routeSummaryMessage(route, selectedRouteIndex)} Avg congestion ${Number(summary.avg_congestion || 0).toFixed(1)}%, Max ${Number(summary.max_congestion || 0).toFixed(1)}%.`
		);
		renderRoutePanel();
	} catch (error) {
		console.error('Route congestion error:', error);
		setRouteStatus(`Route congestion error: ${error.message}`);
	}
}

async function loadRouteInsights() {
	const nowIso = new Date().toISOString();
	const tasks = routeData.map(async (route, idx) => {
		const coords = route.geometry?.coordinates || [];
		if (coords.length < 2) return null;
		const routePoints = coords.map(([lon, lat]) => ({ lat, lon }));
		try {
			const res = await fetch('/predict-route', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					route_points: routePoints,
					timestamp: nowIso,
					sample_count: 30,
					route_distance_m: route.distance,
					route_duration_s: route.duration
				})
			});
			if (!res.ok) return null;
			const payload = await res.json();
			if (!payload.success) return null;
			return payload.summary || null;
		} catch (err) {
			console.error(`Route insight load failed for index ${idx}:`, err);
			return null;
		}
	});
	routeInsights = await Promise.all(tasks);
}

async function updateChartForSelectedRoute(hours) {
	const route = routeData[selectedRouteIndex];
	const coords = route.geometry?.coordinates || [];
	if (coords.length < 2) return;

	const routePoints = coords.map(([lon, lat]) => ({ lat, lon }));
	const response = await fetch('/predict-route-trend', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			route_points: routePoints,
			hours: hours,
			num_predictions: Math.max(6, Math.min(hours * 2, 24)),
			sample_count: 30
		})
	});

	if (!response.ok) throw new Error(`Route trend API error (${response.status})`);
	const data = await response.json();
	if (!data.success || !Array.isArray(data.route_trend)) {
		throw new Error(data.error || 'Invalid route trend payload');
	}

	const labels = data.route_trend.map((entry) => {
		const ts = new Date(entry.timestamp);
		return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	});
	const values = data.route_trend.map((entry) => entry.avg_congestion);
	congestionChart.data.labels = labels;
	congestionChart.data.datasets[0].data = values;
	congestionChart.data.datasets[0].label = 'Route Avg Congestion (%)';
	congestionChart.update();
}

function renderRouteCongestion(routePredictions) {
	clearRouteCongestionLayers();
	routeCongestionLayers = routePredictions.map((prediction) => {
		const lat = prediction.location.latitude;
		const lon = prediction.location.longitude;
		const congestion = prediction.congestion_level;
		const marker = L.circleMarker([lat, lon], {
			radius: 4 + (congestion / 100) * 6,
			fillColor: getCongestionColor(congestion),
			color: '#111827',
			weight: 1,
			opacity: 1,
			fillOpacity: 0.85
		}).addTo(map);

		marker.bindPopup(`
			<h4>Route Congestion</h4>
			<p><strong>Level:</strong> ${congestion.toFixed(1)}%</p>
			<p><strong>Status:</strong> ${getCongestionStatus(congestion)}</p>
			<p><strong>Predicted Speed:</strong> ${prediction.predicted_speed.toFixed(1)} km/h</p>
		`);
		return marker;
	});
}

function openRoutePanel() {
	const panel = document.getElementById('route-panel');
	panel.classList.add('open');
	panel.setAttribute('aria-hidden', 'false');
}

function closeRoutePanel() {
	const panel = document.getElementById('route-panel');
	panel.classList.remove('open');
	panel.setAttribute('aria-hidden', 'true');
}

function detectUserLocation() {
	const locateButton = document.getElementById('locate-me-btn');
	if (!navigator.geolocation) {
		setRouteStatus('Route error: geolocation is not supported in this browser.');
		return;
	}

	locateButton.disabled = true;
	locateButton.textContent = 'Locating...';
	const onSuccess = (position) => {
		const lat = position.coords.latitude;
		const lon = position.coords.longitude;

		if (userLocationMarker) {
			map.removeLayer(userLocationMarker);
		}

		userLocationMarker = L.circleMarker([lat, lon], {
			radius: 9,
			fillColor: '#2563eb',
			color: '#ffffff',
			weight: 2,
			opacity: 1,
			fillOpacity: 0.9
		}).addTo(map);

		userLocationMarker.bindPopup('Your current location').openPopup();
		map.setView([lat, lon], 13);
		setRouteStatus(`Location detected: ${lat.toFixed(5)}, ${lon.toFixed(5)}.`);
		locateButton.disabled = false;
		locateButton.textContent = 'Use My Location';
	};

	const onError = (error) => {
		// Retry once with relaxed settings if first attempt times out.
		if (error.code === error.TIMEOUT) {
			navigator.geolocation.getCurrentPosition(
				onSuccess,
				(finalError) => {
					let message = 'Unable to retrieve your location.';
					if (finalError.code === finalError.PERMISSION_DENIED) {
						message = 'Location access denied. Please allow location permission in browser/site settings.';
					} else if (finalError.code === finalError.POSITION_UNAVAILABLE) {
						message = 'Location unavailable on this device/network right now.';
					} else if (finalError.code === finalError.TIMEOUT) {
						message = 'Location request timed out again. Try enabling device location/GPS and retry.';
					}
					setRouteStatus(`Route error: ${message}`);
					locateButton.disabled = false;
					locateButton.textContent = 'Use My Location';
				},
				{
					enableHighAccuracy: false,
					timeout: 20000,
					maximumAge: 300000
				}
			);
			return;
		}

		let message = 'Unable to retrieve your location.';
		if (error.code === error.PERMISSION_DENIED) {
			message = 'Location access denied. Please allow location permission in browser/site settings.';
		} else if (error.code === error.POSITION_UNAVAILABLE) {
			message = 'Location unavailable on this device/network right now.';
		}
		setRouteStatus(`Route error: ${message}`);
		locateButton.disabled = false;
		locateButton.textContent = 'Use My Location';
	};

	navigator.geolocation.getCurrentPosition(onSuccess, onError, {
		enableHighAccuracy: true,
		timeout: 12000,
		maximumAge: 120000
	});
}
