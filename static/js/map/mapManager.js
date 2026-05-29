import { CONGESTION_COLORS, DEFAULT_MAP_VIEW, TILE_LAYER_URL } from '../config.js';
import { getCongestionColor, getCongestionStatus } from '../utils/congestion.js';
import { formatDurationSeconds, formatFactor } from '../utils/format.js';
import { buildCongestionSegments, selectHotspotIndices } from '../utils/geo.js';

export class MapManager {
	constructor({ onMapSelection, onRouteSelected }) {
		this.onMapSelection = onMapSelection;
		this.onRouteSelected = onRouteSelected;
		this.map = null;
		this.startMarker = null;
		this.endMarker = null;
		this.userLocationMarker = null;
		this.activeRouteClickMode = null;

		this.layers = {
			forecast: L.layerGroup(),
			routes: L.layerGroup(),
			routeSegments: L.layerGroup(),
			hotspots: L.layerGroup()
		};

		this.routeData = [];
		this.canvasRenderer = null;
	}

	initialize() {
		this.map = L.map('map', { preferCanvas: true }).setView(
			[DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lon],
			DEFAULT_MAP_VIEW.zoom
		);
		this.canvasRenderer = L.canvas({ padding: 0.3 });

		L.tileLayer(TILE_LAYER_URL, {
			attribution: '© OpenStreetMap contributors',
			maxZoom: 19
		}).addTo(this.map);

		Object.values(this.layers).forEach((layer) => layer.addTo(this.map));
		this.addLegend();
		this.map.on('click', (event) => this.handleMapClick(event));
	}

	addLegend() {
		const legend = L.control({ position: 'bottomright' });
		legend.onAdd = () => {
			const div = L.DomUtil.create('div', 'leaflet-control-legend');
			div.innerHTML = `
				<h4>Congestion</h4>
				<div class="legend-item"><span class="legend-color" style="background:${CONGESTION_COLORS.low};"></span>Low</div>
				<div class="legend-item"><span class="legend-color" style="background:${CONGESTION_COLORS.medium};"></span>Medium</div>
				<div class="legend-item"><span class="legend-color" style="background:${CONGESTION_COLORS.high};"></span>High</div>
			`;
			return div;
		};
		legend.addTo(this.map);
	}

	handleMapClick(event) {
		if (!this.activeRouteClickMode || !this.onMapSelection) return;
		const lat = Number(event.latlng.lat.toFixed(6));
		const lon = Number(event.latlng.lng.toFixed(6));
		this.onMapSelection(this.activeRouteClickMode, { lat, lon });
		this.activeRouteClickMode = null;
	}

	enableRouteSelectionMode(mode) {
		this.activeRouteClickMode = mode;
	}

	setStartPoint(lat, lon) {
		if (this.startMarker) this.map.removeLayer(this.startMarker);
		this.startMarker = L.marker([lat, lon], { title: 'Start' })
			.addTo(this.map)
			.bindPopup('Start');
	}

	setEndPoint(lat, lon) {
		if (this.endMarker) this.map.removeLayer(this.endMarker);
		this.endMarker = L.marker([lat, lon], { title: 'Destination' })
			.addTo(this.map)
			.bindPopup('Destination');
	}

	getRouteEndpoints() {
		if (!this.startMarker || !this.endMarker) return null;
		const s = this.startMarker.getLatLng();
		const e = this.endMarker.getLatLng();
		return {
			start: { lat: s.lat, lon: s.lng },
			end: { lat: e.lat, lon: e.lng }
		};
	}

	setUserLocation(lat, lon) {
		if (this.userLocationMarker) this.map.removeLayer(this.userLocationMarker);
		this.userLocationMarker = L.circleMarker([lat, lon], {
			radius: 7,
			fillColor: '#1f6dd9',
			color: '#ffffff',
			weight: 2,
			fillOpacity: 0.92
		})
			.addTo(this.map)
			.bindPopup('Your current location');
		this.map.setView([lat, lon], 13);
	}

	renderForecastPredictions(predictions, { fitToData = true } = {}) {
		this.layers.forecast.clearLayers();
		if (!Array.isArray(predictions) || predictions.length === 0) return;

		predictions.forEach((prediction) => {
			const congestion = prediction.congestion_level;
			const marker = L.circleMarker(
				[prediction.location.latitude, prediction.location.longitude],
				{
					radius: 4 + (congestion / 100) * 3.2,
					fillColor: getCongestionColor(congestion),
					color: '#ffffff',
					weight: 1,
					opacity: 0.6,
					fillOpacity: 0.42,
					renderer: this.canvasRenderer
				}
			);

			marker.bindTooltip(
				`<strong>${getCongestionStatus(congestion)}</strong><br/>Congestion: ${congestion.toFixed(1)}%`,
				{
					className: 'route-tooltip',
					sticky: true
				}
			);
			marker.addTo(this.layers.forecast);
		});

		if (fitToData) {
			const bounds = L.latLngBounds(
				predictions.map((entry) => [entry.location.latitude, entry.location.longitude])
			);
			this.map.fitBounds(bounds, { padding: [40, 40] });
		}
	}

	renderAlternativeRoutes(routeData, selectedRouteIndex) {
		this.routeData = routeData;
		this.layers.routes.clearLayers();

		routeData.forEach((route, index) => {
			const coords = (route.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]);
			const active = index === selectedRouteIndex;
			const baseLine = L.polyline(coords, {
				color: active ? '#255bb4' : '#8eb3de',
				weight: active ? 6 : 4,
				opacity: active ? 0.9 : 0.48,
				smoothFactor: 1.4
			});
			baseLine.on('click', () => this.onRouteSelected(index));
			baseLine.addTo(this.layers.routes);
		});

		const activeRoute = routeData[selectedRouteIndex];
		if (activeRoute) {
			const activeCoords = (activeRoute.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]);
			if (activeCoords.length > 1) {
				this.map.fitBounds(L.latLngBounds(activeCoords), { padding: [34, 34] });
			}
		}
	}

	renderRouteCongestion(routePredictions, summary) {
		this.layers.routeSegments.clearLayers();
		this.layers.hotspots.clearLayers();
		if (!Array.isArray(routePredictions) || routePredictions.length < 2) return;

		const etaFactor = summary?.eta?.ml_adjustment_factor || 1;
		const segments = buildCongestionSegments(routePredictions, etaFactor);
		segments.forEach((segment) => {
			L.polyline(segment.coords, {
				color: getCongestionColor(segment.congestion),
				weight: 7,
				opacity: 0.94,
				lineCap: 'round',
				lineJoin: 'round',
				smoothFactor: 1.8
			})
				.bindTooltip(
					`
						<strong>${segment.status} congestion</strong><br/>
						Congestion: ${segment.congestion.toFixed(1)}%<br/>
						Predicted delay: ${formatDurationSeconds(segment.delaySeconds)}<br/>
						ETA adjustment: ${formatFactor(segment.etaFactor)}
					`,
					{ className: 'route-tooltip', sticky: true }
				)
				.addTo(this.layers.routeSegments);
		});

		const hotspotIndices = selectHotspotIndices(routePredictions);
		hotspotIndices.forEach((index) => {
			const p = routePredictions[index];
			const congestion = p.congestion_level;
			L.circleMarker([p.location.latitude, p.location.longitude], {
				radius: 4.4,
				fillColor: getCongestionColor(congestion),
				color: '#0f1f2c',
				weight: 1,
				opacity: 0.66,
				fillOpacity: 0.56,
				renderer: this.canvasRenderer
			})
				.bindTooltip(
					`
						<strong>Traffic hotspot</strong><br/>
						Congestion: ${congestion.toFixed(1)}%<br/>
						Predicted speed: ${Number(p.predicted_speed).toFixed(1)} km/h<br/>
						ETA adjustment: ${formatFactor(etaFactor)}
					`,
					{ className: 'route-tooltip', sticky: true }
				)
				.addTo(this.layers.hotspots);
		});
	}

	clearRouteCongestion() {
		this.layers.routeSegments.clearLayers();
		this.layers.hotspots.clearLayers();
	}

	clearRouteVisuals() {
		this.layers.routes.clearLayers();
		this.clearRouteCongestion();
		this.routeData = [];
	}

	clearAllRouteState() {
		this.clearRouteVisuals();
		if (this.startMarker) this.map.removeLayer(this.startMarker);
		if (this.endMarker) this.map.removeLayer(this.endMarker);
		this.startMarker = null;
		this.endMarker = null;
		this.activeRouteClickMode = null;
	}
}
