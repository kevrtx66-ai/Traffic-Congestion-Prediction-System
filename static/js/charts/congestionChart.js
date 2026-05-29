import { formatTimeLabel } from '../utils/format.js';

export class CongestionChart {
	constructor(canvasEl) {
		this.chart = new Chart(canvasEl.getContext('2d'), {
			type: 'line',
			data: {
				labels: [],
				datasets: [
					{
						label: 'Average Congestion (%)',
						data: [],
						borderColor: '#1f6dd9',
						backgroundColor: 'rgba(31, 109, 217, 0.12)',
						fill: true,
						borderWidth: 2.2,
						tension: 0.32,
						cubicInterpolationMode: 'monotone',
						pointRadius: 0,
						pointHoverRadius: 3,
						pointHitRadius: 12
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					intersect: false,
					mode: 'index'
				},
				animation: {
					duration: 420,
					easing: 'easeOutCubic'
				},
				plugins: {
					legend: { display: false },
					tooltip: {
						backgroundColor: 'rgba(17, 30, 44, 0.92)',
						titleColor: '#ffffff',
						bodyColor: '#ffffff',
						padding: 10
					}
				},
				scales: {
					y: {
						beginAtZero: true,
						max: 100,
						ticks: { color: '#5e7a93', maxTicksLimit: 6 },
						grid: { color: 'rgba(168, 187, 206, 0.25)' },
						title: {
							display: true,
							text: 'Congestion %',
							color: '#39566f',
							font: { size: 11, weight: '600' }
						}
					},
					x: {
						ticks: { color: '#5e7a93', maxTicksLimit: 7 },
						grid: { display: false },
						title: {
							display: true,
							text: 'Time',
							color: '#39566f',
							font: { size: 11, weight: '600' }
						}
					}
				}
			}
		});
	}

	updateWithPredictions(predictions, label = 'Average Congestion (%)') {
		const sorted = [...predictions].sort(
			(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
		);
		this.chart.data.labels = sorted.map((entry) => formatTimeLabel(entry.timestamp));
		this.chart.data.datasets[0].data = sorted.map((entry) => entry.congestion_level);
		this.chart.data.datasets[0].label = label;
		this.chart.update();
	}

	updateSeries(labels, data, label) {
		this.chart.data.labels = labels;
		this.chart.data.datasets[0].data = data;
		this.chart.data.datasets[0].label = label;
		this.chart.update();
	}
}
