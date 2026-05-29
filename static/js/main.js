import { REFRESH_INTERVAL_MS, ROUTE_SAMPLE_COUNT } from './config.js';
import { CongestionChart } from './charts/congestionChart.js';
import { MapManager } from './map/mapManager.js';
import { fetchForecast, fetchRoutePrediction, fetchRouteTrend } from './services/api.js';
import { fetchAlternativeRoutes, geocodePlace } from './services/external.js';
import { formatDateTime, formatTimeLabel } from './utils/format.js';
import { DashboardUI } from './ui/dashboardUI.js';

const state = {
	isFetching: false,
	routeData: [],
	routeInsights: [],
	routeCongestionCache: [],
	selectedRouteIndex: 0,
	viewMode: 'congestion'
};

let ui;
let mapManager;
let chart;

document.addEventListener('DOMContentLoaded', () => {
	ui = new DashboardUI();
	mapManager = new MapManager({
		onMapSelection: handleMapSelection,
		onRouteSelected: selectRoute
	});
	mapManager.initialize();
	chart = new CongestionChart(document.getElementById('congestion-chart'));

	ui.bindHandlers({
		onRefresh: fetchCongestionData,
		onTimeWindowChange: fetchCongestionData,
		onLocateMe: detectUserLocation,
		onSetStartMode: () => {
			mapManager.enableRouteSelectionMode('start');
			ui.setRouteStatus('Route: click map to set start point.');
		},
		onSetEndMode: () => {
			mapManager.enableRouteSelectionMode('end');
			ui.setRouteStatus('Route: click map to set destination point.');
		},
		onDrawRoute: drawShortestRoute,
		onClearRoute: clearRoute,
		onFindStart: () => findPlaceAndSetPoint('start'),
		onFindEnd: () => findPlaceAndSetPoint('end'),
		onToggleViewMode: handleViewModeChange,
		onToggleChartSize: () => {
			setTimeout(() => {
				chart.chart.resize();
				mapManager.map.invalidateSize();
			}, 220);
		}
	});
	state.viewMode = ui.getSelectedViewMode();

	fetchCongestionData();
	setInterval(fetchCongestionData, REFRESH_INTERVAL_MS);
	setupAutoFitResize();
});

function hasActiveRoute() {
	return state.routeData.length > 0 && state.routeData[state.selectedRouteIndex];
}

async function fetchCongestionData() {
	if (state.isFetching) return;
	state.isFetching = true;
	const hours = ui.getTimeWindowHours();

	try {
		ui.setRefreshLoading(true);
		ui.setUpdateStatus('Fetching data...');
		const data = await fetchForecast(hours);
		mapManager.renderForecastPredictions(data.predictions, {
			fitToData: !hasActiveRoute()
		});

		if (hasActiveRoute()) {
			await updateChartForSelectedRoute(hours);
		} else {
			chart.updateWithPredictions(data.predictions);
		}

		ui.setUpdateStatus(`Last updated: ${formatDateTime(new Date().toISOString())}`);
	} catch (error) {
		console.error('Forecast fetch error:', error);
		ui.setUpdateStatus(`Error: ${error.message}`);
	} finally {
		ui.setRefreshLoading(false);
		state.isFetching = false;
	}
}

function handleMapSelection(mode, point) {
	if (mode === 'start') {
		mapManager.setStartPoint(point.lat, point.lon);
		ui.setRouteStatus('Route: start set. Click "Set Destination on Map" then click map.');
		return;
	}
	if (mode === 'end') {
		mapManager.setEndPoint(point.lat, point.lon);
		ui.setRouteStatus('Route: destination set. Click "Find Shortest Route".');
	}
}

async function findPlaceAndSetPoint(type) {
	try {
		const query = ui.getPlaceQuery(type);
		if (!query) {
			throw new Error(`Please enter a ${type === 'start' ? 'source' : 'destination'} location name`);
		}
		ui.setRouteStatus(`Route: finding ${type} location...`);
		const location = await geocodePlace(query);
		if (type === 'start') {
			mapManager.setStartPoint(location.lat, location.lon);
			ui.setRouteStatus('Route: source location set. Now set destination.');
		} else {
			mapManager.setEndPoint(location.lat, location.lon);
			ui.setRouteStatus('Route: destination location set. Click "Find Shortest Route".');
		}
		mapManager.map.setView([location.lat, location.lon], 13);
	} catch (error) {
		console.error('Geocode error:', error);
		ui.setRouteStatus(`Route error: ${error.message}`);
	}
}

async function drawShortestRoute() {
	try {
		const points = mapManager.getRouteEndpoints();
		if (!points) throw new Error('Please set source and destination first.');

		ui.setRouteStatus('Route: fetching shortest path...');
		state.routeData = await fetchAlternativeRoutes(points.start, points.end);
		state.routeInsights = new Array(state.routeData.length).fill(null);
		state.routeCongestionCache = new Array(state.routeData.length).fill(null);
		state.selectedRouteIndex = 0;

		mapManager.renderAlternativeRoutes(state.routeData, state.selectedRouteIndex);
		await loadRouteInsights();
		ui.renderRoutePanel(state.routeData, state.routeInsights, state.selectedRouteIndex, selectRoute);
		ui.openRoutePanel();

		const selectedRoute = state.routeData[state.selectedRouteIndex];
		const selectedInsight = state.routeInsights[state.selectedRouteIndex];
		ui.setRouteStatus(ui.getRouteSummaryMessage(selectedRoute, selectedInsight, state.selectedRouteIndex));

		await applyRouteViewMode();
		await updateChartForSelectedRoute(ui.getTimeWindowHours());
	} catch (error) {
		console.error('Route draw error:', error);
		ui.setRouteStatus(`Route error: ${error.message}`);
	}
}

function clearRoute() {
	mapManager.clearAllRouteState();
	state.routeData = [];
	state.routeInsights = [];
	state.routeCongestionCache = [];
	state.selectedRouteIndex = 0;
	ui.resetRouteInputs();
	ui.closeRoutePanel();
	ui.setRouteStatus('Route: cleared. Click "Set Source on Map" then click map.');
}

async function loadRouteInsights() {
	const nowIso = new Date().toISOString();
	const tasks = state.routeData.map(async (route) => {
		const coords = route.geometry?.coordinates || [];
		if (coords.length < 2) return null;

		const routePoints = coords.map(([lon, lat]) => ({ lat, lon }));
		try {
			const data = await fetchRoutePrediction({
				route_points: routePoints,
				timestamp: nowIso,
				sample_count: ROUTE_SAMPLE_COUNT,
				route_distance_m: route.distance,
				route_duration_s: route.duration
			});
			return {
				summary: data.summary || null,
				routePredictions: data.route_predictions || [],
				fetchedAt: Date.now()
			};
		} catch (error) {
			console.error('Route insight fetch failed:', error);
			return null;
		}
	});

	const results = await Promise.all(tasks);
	state.routeCongestionCache = results;
	state.routeInsights = results.map((entry) => entry?.summary || null);
}

async function selectRoute(index) {
	state.selectedRouteIndex = index;
	mapManager.renderAlternativeRoutes(state.routeData, state.selectedRouteIndex);
	ui.renderRoutePanel(state.routeData, state.routeInsights, state.selectedRouteIndex, selectRoute);
	await applyRouteViewMode();
	updateChartForSelectedRoute(ui.getTimeWindowHours()).catch((error) => {
		console.error('Route trend update error:', error);
	});

	const route = state.routeData[index];
	const insight = state.routeInsights[index];
	ui.setRouteStatus(ui.getRouteSummaryMessage(route, insight, index));
}

function getCachedRouteCongestion(index) {
	return state.routeCongestionCache[index];
}

function setCachedRouteCongestion(index, payload) {
	state.routeCongestionCache[index] = payload;
}

async function fetchAndRenderRouteCongestion({ forceRefresh = false } = {}) {
	if (!hasActiveRoute()) return;
	const route = state.routeData[state.selectedRouteIndex];
	const cacheIndex = state.selectedRouteIndex;
	const coords = route.geometry?.coordinates || [];
	if (coords.length < 2) return;

	try {
		if (!forceRefresh) {
			const cached = getCachedRouteCongestion(cacheIndex);
			if (cached && Array.isArray(cached.routePredictions) && cached.routePredictions.length > 1) {
				state.routeInsights[cacheIndex] = cached.summary || state.routeInsights[cacheIndex];
				if (state.viewMode === 'congestion') {
					mapManager.renderRouteCongestion(cached.routePredictions, cached.summary);
				} else {
					mapManager.clearRouteCongestion();
				}
				ui.renderRoutePanel(
					state.routeData,
					state.routeInsights,
					state.selectedRouteIndex,
					selectRoute
				);
				return cached;
			}
		}

		ui.setRouteStatus(
			`${ui.getRouteSummaryMessage(route, state.routeInsights[state.selectedRouteIndex], state.selectedRouteIndex)} Predicting congestion...`
		);

		const routePoints = coords.map(([lon, lat]) => ({ lat, lon }));
		const data = await fetchRoutePrediction({
			route_points: routePoints,
			timestamp: new Date().toISOString(),
			sample_count: ROUTE_SAMPLE_COUNT,
			route_distance_m: route.distance,
			route_duration_s: route.duration
		});

		const cachePayload = {
			summary: data.summary || null,
			routePredictions: data.route_predictions || [],
			fetchedAt: Date.now()
		};
		setCachedRouteCongestion(cacheIndex, cachePayload);
		state.routeInsights[cacheIndex] = cachePayload.summary;
		if (state.viewMode === 'congestion') {
			mapManager.renderRouteCongestion(cachePayload.routePredictions, cachePayload.summary);
		} else {
			mapManager.clearRouteCongestion();
		}
		ui.renderRoutePanel(state.routeData, state.routeInsights, state.selectedRouteIndex, selectRoute);

		const summary = cachePayload.summary || {};
		ui.setRouteStatus(
			`${ui.getRouteSummaryMessage(route, summary, state.selectedRouteIndex)} Avg congestion ${Number(summary.avg_congestion || 0).toFixed(1)}%, Max ${Number(summary.max_congestion || 0).toFixed(1)}%.`
		);
		return cachePayload;
	} catch (error) {
		console.error('Route congestion error:', error);
		ui.setRouteStatus(`Route congestion error: ${error.message}`);
	}
}

async function applyRouteViewMode() {
	if (!hasActiveRoute()) return;
	if (state.viewMode === 'normal') {
		mapManager.clearRouteCongestion();
		return;
	}
	await fetchAndRenderRouteCongestion();
}

async function handleViewModeChange(mode) {
	state.viewMode = mode;
	if (!hasActiveRoute()) return;

	await applyRouteViewMode();
	const route = state.routeData[state.selectedRouteIndex];
	const insight = state.routeInsights[state.selectedRouteIndex];
	const modeLabel = state.viewMode === 'congestion' ? 'Congestion view' : 'Normal view';
	ui.setRouteStatus(`${modeLabel}: ${ui.getRouteSummaryMessage(route, insight, state.selectedRouteIndex)}`);
}

async function updateChartForSelectedRoute(hours) {
	if (!hasActiveRoute()) return;
	const route = state.routeData[state.selectedRouteIndex];
	const coords = route.geometry?.coordinates || [];
	if (coords.length < 2) return;

	const routePoints = coords.map(([lon, lat]) => ({ lat, lon }));
	const data = await fetchRouteTrend({
		route_points: routePoints,
		hours,
		num_predictions: Math.max(6, Math.min(hours * 2, 24)),
		sample_count: ROUTE_SAMPLE_COUNT
	});

	const labels = data.route_trend.map((entry) => formatTimeLabel(entry.timestamp));
	const values = data.route_trend.map((entry) => entry.avg_congestion);
	chart.updateSeries(labels, values, 'Route Avg Congestion (%)');
}

function detectUserLocation() {
	if (!navigator.geolocation) {
		ui.setRouteStatus('Route error: geolocation is not supported in this browser.');
		return;
	}

	ui.setLocateLoading(true);

	const onSuccess = (position) => {
		const lat = position.coords.latitude;
		const lon = position.coords.longitude;
		mapManager.setUserLocation(lat, lon);
		ui.setLocateLoading(false);
		ui.setRouteStatus(`Location detected: ${lat.toFixed(5)}, ${lon.toFixed(5)}.`);
	};

	const onError = (error) => {
		let message = 'Unable to retrieve your location.';
		if (error.code === error.PERMISSION_DENIED) {
			message = 'Location access denied. Please allow location permission in browser settings.';
		} else if (error.code === error.POSITION_UNAVAILABLE) {
			message = 'Location unavailable on this device/network right now.';
		} else if (error.code === error.TIMEOUT) {
			message = 'Location request timed out. Please try again.';
		}
		ui.setLocateLoading(false);
		ui.setRouteStatus(`Route error: ${message}`);
	};

	navigator.geolocation.getCurrentPosition(onSuccess, onError, {
		enableHighAccuracy: true,
		timeout: 12000,
		maximumAge: 120000
	});
}

function setupAutoFitResize() {
	let resizeTimer;
	const refreshMapLayout = () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			if (!mapManager?.map) return;
			mapManager.map.invalidateSize({ pan: false, debounceMoveend: true });
			chart?.chart?.resize();
		}, 80);
	};

	window.addEventListener('resize', refreshMapLayout);

	const mapEl = document.getElementById('map');
	if ('ResizeObserver' in window && mapEl) {
		const observer = new ResizeObserver(refreshMapLayout);
		observer.observe(mapEl);
	}
}
