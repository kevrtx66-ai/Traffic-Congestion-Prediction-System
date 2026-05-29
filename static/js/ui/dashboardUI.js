import { formatDurationSeconds, formatFactor } from '../utils/format.js';

export class DashboardUI {
	constructor() {
		this.elements = {
			refreshBtn: document.getElementById('refresh-btn'),
			timeWindow: document.getElementById('time-window'),
			locateBtn: document.getElementById('locate-me-btn'),
			setStartBtn: document.getElementById('set-start-btn'),
			setEndBtn: document.getElementById('set-end-btn'),
			drawRouteBtn: document.getElementById('draw-route-btn'),
			clearRouteBtn: document.getElementById('clear-route-btn'),
			findStartBtn: document.getElementById('find-start-btn'),
			findEndBtn: document.getElementById('find-end-btn'),
			startInput: document.getElementById('start-place'),
			endInput: document.getElementById('end-place'),
			routeStatus: document.getElementById('route-status'),
			updateStatus: document.getElementById('update-status'),
			routePanel: document.getElementById('route-panel'),
			closeRoutePanelBtn: document.getElementById('close-route-panel-btn'),
			routeList: document.getElementById('route-list'),
			chartContainer: document.getElementById('chart-container'),
			toggleChartSizeBtn: document.getElementById('toggle-chart-size-btn'),
			viewModeControl: document.getElementById('view-mode-control'),
			congestionViewToggle: document.getElementById('congestion-view-toggle')
		};
	}

	bindHandlers(handlers) {
		const el = this.elements;
		el.refreshBtn.addEventListener('click', handlers.onRefresh);
		el.timeWindow.addEventListener('change', handlers.onTimeWindowChange);
		el.locateBtn.addEventListener('click', handlers.onLocateMe);
		el.setStartBtn.addEventListener('click', handlers.onSetStartMode);
		el.setEndBtn.addEventListener('click', handlers.onSetEndMode);
		el.drawRouteBtn.addEventListener('click', handlers.onDrawRoute);
		el.clearRouteBtn.addEventListener('click', handlers.onClearRoute);
		el.findStartBtn.addEventListener('click', handlers.onFindStart);
		el.findEndBtn.addEventListener('click', handlers.onFindEnd);
		el.congestionViewToggle.addEventListener('change', () => {
			this.syncViewModeControl();
			if (handlers.onToggleViewMode) {
				handlers.onToggleViewMode(this.getSelectedViewMode());
			}
		});
		el.closeRoutePanelBtn.addEventListener('click', () => this.closeRoutePanel());
		el.toggleChartSizeBtn.addEventListener('click', () => {
			this.toggleChartSize();
			if (handlers.onToggleChartSize) handlers.onToggleChartSize();
		});

		this.syncViewModeControl();
	}

	getTimeWindowHours() {
		return Number(this.elements.timeWindow.value);
	}

	getPlaceQuery(type) {
		return type === 'start'
			? this.elements.startInput.value.trim()
			: this.elements.endInput.value.trim();
	}

	getSelectedViewMode() {
		return this.elements.congestionViewToggle.checked ? 'congestion' : 'normal';
	}

	setSelectedViewMode(mode) {
		this.elements.congestionViewToggle.checked = mode === 'congestion';
		this.syncViewModeControl();
	}

	syncViewModeControl() {
		const mode = this.getSelectedViewMode();
		this.elements.viewModeControl.setAttribute('data-mode', mode);
		this.elements.congestionViewToggle.setAttribute(
			'aria-checked',
			String(mode === 'congestion')
		);
	}

	setRouteStatus(message) {
		this.elements.routeStatus.textContent = message;
	}

	setUpdateStatus(message) {
		this.elements.updateStatus.textContent = message;
	}

	setRefreshLoading(isLoading) {
		this.elements.refreshBtn.disabled = isLoading;
		this.elements.refreshBtn.textContent = isLoading ? 'Loading...' : 'Refresh';
	}

	setLocateLoading(isLoading) {
		this.elements.locateBtn.disabled = isLoading;
		this.elements.locateBtn.textContent = isLoading ? 'Locating...' : 'Current Location';
	}

	openRoutePanel() {
		this.elements.routePanel.classList.add('open');
		this.elements.routePanel.setAttribute('aria-hidden', 'false');
	}

	closeRoutePanel() {
		this.elements.routePanel.classList.remove('open');
		this.elements.routePanel.setAttribute('aria-hidden', 'true');
	}

	toggleChartSize() {
		const expanded = this.elements.chartContainer.classList.toggle('chart-expanded');
		this.elements.toggleChartSizeBtn.textContent = expanded ? 'Minimize' : 'Expand';
		this.elements.toggleChartSizeBtn.setAttribute('aria-expanded', String(expanded));
	}

	resetRouteInputs() {
		this.elements.startInput.value = '';
		this.elements.endInput.value = '';
	}

	renderRoutePanel(routeData, routeInsights, selectedRouteIndex, onSelectRoute) {
		this.elements.routeList.innerHTML = '';
		routeData.forEach((route, index) => {
			const insight = routeInsights[index];
			const km = (route.distance / 1000).toFixed(2);
			const rawLabel = formatDurationSeconds(route.duration);
			const mlSeconds = insight?.eta?.ml_adjusted_duration_seconds || route.duration;
			const mlLabel = formatDurationSeconds(mlSeconds);
			const factor = formatFactor(insight?.eta?.ml_adjustment_factor);
			const avgCongestion = Number(insight?.avg_congestion || 0).toFixed(1);

			const card = document.createElement('button');
			card.type = 'button';
			card.className = `route-card ${index === selectedRouteIndex ? 'active' : ''}`;
			card.innerHTML = `
				<div class="route-card-top">
					<span class="route-title">${index === 0 ? 'Best Route' : `Alternative ${index}`}</span>
					<span class="route-tag">ETA</span>
				</div>
				<div class="route-card-meta">${km} km</div>
				<div class="route-card-foot">Raw ETA: ${rawLabel}</div>
				<div class="route-card-foot">ML ETA: ${mlLabel}</div>
				<div class="route-card-foot">Avg congestion: ${avgCongestion}%</div>
				<div class="route-card-foot">ETA adjustment: ${factor}</div>
			`;
			card.addEventListener('click', () => onSelectRoute(index));
			this.elements.routeList.appendChild(card);
		});
	}

	getRouteSummaryMessage(route, insight, index) {
		const km = (route.distance / 1000).toFixed(2);
		const rawLabel = formatDurationSeconds(route.duration);
		const mlSeconds = insight?.eta?.ml_adjusted_duration_seconds || route.duration;
		const mlLabel = formatDurationSeconds(mlSeconds);
		const routeLabel = index === 0 ? 'Best route' : `Alternative ${index}`;
		return `Route: ${routeLabel} ${km} km, Raw ETA ${rawLabel}, ML ETA ${mlLabel}.`;
	}
}
