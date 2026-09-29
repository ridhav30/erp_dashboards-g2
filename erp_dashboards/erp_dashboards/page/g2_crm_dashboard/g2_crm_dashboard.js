frappe.pages['g2-crm-dashboard'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('CRM Dashboard'),
		single_column: true
	});

	// Mark wrapper with full-width helper class
	$(wrapper).addClass('full-width-page');

	// Render Speedometer dashboard template
	var template = frappe.templates['g2-crm-dashboard'] || frappe.templates['g2_crm_dashboard'];
	if (template) {
		$(frappe.render_template(template, {})).appendTo(page.main);
	}

	// Format count as clean integer with commas
	function format_count(val) {
		var num = Math.round(parseFloat(val) || 0);
		return num.toLocaleString('en-US');
	}

	// Animate digital counter roll-up to real-world value
	function animate_odometer($el, target_val, duration) {
		var start_val = Math.round(parseFloat($el.attr('data-val') || 0));
		var end_val = Math.round(parseFloat(target_val || 0));
		$el.attr('data-val', end_val);

		var start_time = null;
		duration = duration || 1000;

		function step(timestamp) {
			if (!start_time) start_time = timestamp;
			var progress = Math.min((timestamp - start_time) / duration, 1);
			// Ease out quad
			var ease = 1 - (1 - progress) * (1 - progress);
			var current = Math.floor(start_val + (end_val - start_val) * ease);
			$el.text(format_count(current));

			if (progress < 1) {
				window.requestAnimationFrame(step);
			} else {
				$el.text(format_count(end_val));
			}
		}
		window.requestAnimationFrame(step);
	}

	// Apply needle rotation & arc fill to 180° gauge
	function apply_needle_rotation($card, angle, dashoffset) {
		var $needle = $card.find('.gauge-needle-group');
		var $arc = $card.find('.gauge-val-arc');

		// 1. Update SVG arc fill
		if (dashoffset !== undefined) {
			$arc.css('stroke-dashoffset', dashoffset);
			$arc.attr('stroke-dashoffset', dashoffset);
		}

		// 2. Rotate needle (support CSS transform and native SVG transform attribute)
		$needle.css({
			'transform-box': 'view-box',
			'transform-origin': '100px 100px',
			'transform': 'rotate(' + angle + 'deg)',
			'-webkit-transform': 'rotate(' + angle + 'deg)'
		});
		$needle.attr('transform', 'rotate(' + angle + ' 100 100)');
	}

	// Animate 180° speedometer gauge to exact real-world CRM value
	function set_speedometer_gauge(id_suffix, value, animate_number) {
		var val = parseFloat(value) || 0;

		// Scale capacities: Monthly gauges max at 10K, Open Opportunity max at 200K
		var max_val = 10000;
		if (id_suffix === 'open-opportunities') {
			max_val = 200000;
			if (val > 200000) {
				max_val = Math.ceil(val / 100000) * 100000;
			}
		} else {
			if (val > 10000) {
				max_val = Math.ceil(val / 10000) * 10000;
			}
		}

		var pct = max_val > 0 ? Math.min(Math.max(val / max_val, 0), 1) : 0;
		var total_arc = 235.62;
		var dashoffset = total_arc * (1 - pct);
		var angle = -90 + (pct * 180);

		var $card = $('#card-' + id_suffix);

		// Animate needle and arc to exact angle
		apply_needle_rotation($card, angle, dashoffset);

		// Update max scale label
		var max_label;
		if (max_val >= 1000000) {
			var m = max_val / 1000000;
			max_label = (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
		} else if (max_val >= 1000) {
			var k = max_val / 1000;
			max_label = (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'K';
		} else {
			max_label = max_val.toString();
		}
		$('#max-' + id_suffix).text(max_label);

		// Animate count readout to exact real-world figure
		var $val_el = $('#count-' + id_suffix);
		if (animate_number !== false) {
			animate_odometer($val_el, val);
		} else {
			$val_el.text(format_count(val));
		}
	}

	// Update all 4 cards with real CRM data
	function render_crm_data(data) {
		set_speedometer_gauge('new-leads', data.new_leads);
		set_speedometer_gauge('new-opportunities', data.new_opportunities);
		set_speedometer_gauge('won-opportunities', data.won_opportunities);
		set_speedometer_gauge('open-opportunities', data.open_opportunities);
	}

	// --- INCOMING LEADS CHART ENGINE ---
	var frappe_chart_instance = null;

	function render_svg_leads_chart($wrapper, labels, values) {
		if (!labels.length) {
			$wrapper.html('<div style="text-align:center; padding: 60px 0; color: #94a3b8; font-size: 13px;">' + __('No lead activity in this period') + '</div>');
			return;
		}

		var w = 1000;
		var h = 280;
		var padLeft = 55;
		var padRight = 25;
		var padTop = 25;
		var padBottom = 45;

		var chartW = w - padLeft - padRight;
		var chartH = h - padTop - padBottom;

		var maxRaw = Math.max.apply(null, values);
		if (maxRaw <= 0) maxRaw = 20;
		var maxY = Math.ceil(maxRaw / 20) * 20;
		if (maxY < 20) maxY = 20;

		var numPoints = labels.length;
		var coords = [];
		for (var i = 0; i < numPoints; i++) {
			var px = padLeft + (numPoints > 1 ? (i / (numPoints - 1)) * chartW : chartW / 2);
			var val = values[i] || 0;
			var py = padTop + chartH - (val / maxY) * chartH;
			coords.push({ x: px, y: py, val: val, label: labels[i] });
		}

		// Build line and area paths
		var pathD = '';
		var areaD = '';
		coords.forEach(function(pt, idx) {
			if (idx === 0) {
				pathD += 'M ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1);
				areaD += 'M ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1);
			} else {
				pathD += ' L ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1);
				areaD += ' L ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1);
			}
		});

		var baseY = padTop + chartH;
		areaD += ' L ' + coords[coords.length - 1].x.toFixed(1) + ' ' + baseY;
		areaD += ' L ' + coords[0].x.toFixed(1) + ' ' + baseY + ' Z';

		// Generate horizontal grid lines
		var gridLinesHtml = '';
		var ySteps = [0, 0.25, 0.5, 0.75, 1];
		ySteps.forEach(function(step) {
			var yVal = Math.round(maxY * step);
			var yPos = padTop + chartH - (step * chartH);
			gridLinesHtml += '<line x1="' + padLeft + '" y1="' + yPos + '" x2="' + (padLeft + chartW) + '" y2="' + yPos + '" class="chart-grid-line" />';
			gridLinesHtml += '<text x="' + (padLeft - 12) + '" y="' + (yPos + 4) + '" text-anchor="end" class="chart-axis-text">' + (step === 1 ? maxY.toFixed(2) : yVal) + '</text>';
		});

		// Generate X-axis date labels (show evenly spaced labels)
		var xLabelsHtml = '';
		var stepSkip = Math.max(1, Math.floor(numPoints / 14));
		coords.forEach(function(pt, idx) {
			if (idx % stepSkip === 0 || idx === numPoints - 1) {
				xLabelsHtml += '<text x="' + pt.x.toFixed(1) + '" y="' + (baseY + 22) + '" text-anchor="middle" class="chart-axis-text">' + pt.label + '</text>';
			}
		});

		// Generate interactive hover points
		var pointsHtml = '';
		coords.forEach(function(pt) {
			pointsHtml += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="3.5" class="chart-point-dot" data-val="' + pt.val + '" data-label="' + pt.label + '"><title>' + pt.label + ': ' + pt.val + ' leads</title></circle>';
		});

		var svgHtml = [
			'<svg class="svg-chart-svg" viewBox="0 0 ' + w + ' ' + h + '">',
			'<defs>',
			'  <linearGradient id="pink-area-grad" x1="0%" y1="0%" x2="0%" y2="100%">',
			'    <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.22" />',
			'    <stop offset="100%" stop-color="#f43f5e" stop-opacity="0.0" />',
			'  </linearGradient>',
			'</defs>',
			gridLinesHtml,
			'<line x1="' + padLeft + '" y1="' + baseY + '" x2="' + (padLeft + chartW) + '" y2="' + baseY + '" class="chart-axis-line" />',
			'<path class="chart-area-fill" d="' + areaD + '" />',
			'<path class="chart-line-stroke" d="' + pathD + '" />',
			pointsHtml,
			xLabelsHtml,
			'</svg>'
		].join('');

		$wrapper.html(svgHtml);
	}

	function render_incoming_leads_chart(chart_data) {
		var $wrapper = $('#incoming-leads-chart-wrapper');
		if (!$wrapper.length || !chart_data) return;

		var labels = chart_data.labels || [];
		var values = (chart_data.datasets && chart_data.datasets[0]) ? chart_data.datasets[0].values : [];

		$wrapper.empty();

		// Check if native Frappe Chart can be used
		if (window.frappe && frappe.Chart) {
			try {
				frappe_chart_instance = new frappe.Chart($wrapper[0], {
					title: "",
					data: {
						labels: labels,
						datasets: [{
							name: __('Incoming Leads'),
							values: values
						}]
					},
					type: 'line',
					height: 260,
					colors: ['#f43f5e'],
					lineOptions: {
						regionFill: 1,
						hideDots: 1,
						spline: 0
					},
					axisOptions: {
						xIsSeries: true,
						shortenYAxisNumbers: 0
					}
				});
				return;
			} catch (e) {
				console.warn('frappe.Chart fallback to responsive SVG', e);
			}
		}

		// Fallback to high-precision responsive SVG chart
		render_svg_leads_chart($wrapper, labels, values);
	}

	function load_incoming_leads_chart() {
		var timespan = $('#select-chart-timespan').val() || 'Last Quarter';
		var time_interval = $('#select-chart-interval').val() || 'Weekly';

		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_incoming_leads_chart',
			args: {
				timespan: timespan,
				time_interval: time_interval
			},
			callback: function(r) {
				if (r && r.message) {
					render_incoming_leads_chart(r.message);
					$('#leads-chart-sync-time').text(__('Last synced just now'));
				}
			}
		});
	}

	// --- OPPORTUNITY TRENDS CHART ENGINE ---
	var frappe_opp_chart_instance = null;

	function render_svg_opp_chart($wrapper, labels, values) {
		if (!labels.length) {
			$wrapper.html('<div style="text-align:center; padding: 60px 0; color: #94a3b8; font-size: 13px;">' + __('No opportunity activity in this period') + '</div>');
			return;
		}

		var w = 1000;
		var h = 280;
		var padLeft = 55;
		var padRight = 25;
		var padTop = 25;
		var padBottom = 45;

		var chartW = w - padLeft - padRight;
		var chartH = h - padTop - padBottom;

		var maxRaw = Math.max.apply(null, values);
		if (maxRaw <= 0) maxRaw = 1;
		var maxY = (maxRaw <= 2) ? 1 : Math.ceil(maxRaw);

		var numPoints = labels.length;
		var baseY = padTop + chartH;
		var barW = Math.max(12, Math.min(32, (chartW / numPoints) * 0.55));

		// Generate horizontal grid lines
		var gridLinesHtml = '';
		var ySteps = [0, 0.5, 1];
		if (maxY > 2) {
			ySteps = [0, 0.25, 0.5, 0.75, 1];
		}
		ySteps.forEach(function(step) {
			var yVal = (maxY <= 2 && step === 0.5) ? '0.5' : Math.round(maxY * step);
			var yPos = padTop + chartH - (step * chartH);
			gridLinesHtml += '<line x1="' + padLeft + '" y1="' + yPos + '" x2="' + (padLeft + chartW) + '" y2="' + yPos + '" class="chart-grid-line" />';
			gridLinesHtml += '<text x="' + (padLeft - 12) + '" y="' + (yPos + 4) + '" text-anchor="end" class="chart-axis-text">' + yVal + '</text>';
		});

		// Generate bars
		var barsHtml = '';
		var xLabelsHtml = '';
		var stepSkip = Math.max(1, Math.floor(numPoints / 14));

		for (var i = 0; i < numPoints; i++) {
			var px = padLeft + (numPoints > 1 ? (i / (numPoints - 1)) * chartW : chartW / 2);
			var val = values[i] || 0;
			var barH = maxY > 0 ? (val / maxY) * chartH : 0;
			var barY = baseY - barH;

			if (val > 0) {
				barsHtml += '<rect x="' + (px - barW / 2).toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + barW + '" height="' + barH.toFixed(1) + '" fill="#f472b6" rx="2" ry="2" class="chart-bar"><title>' + labels[i] + ': ' + val + ' opportunities</title></rect>';
			}

			if (i % stepSkip === 0 || i === numPoints - 1) {
				xLabelsHtml += '<text x="' + px.toFixed(1) + '" y="' + (baseY + 22) + '" text-anchor="middle" class="chart-axis-text">' + labels[i] + '</text>';
			}
		}

		var svgHtml = [
			'<svg class="svg-chart-svg" viewBox="0 0 ' + w + ' ' + h + '">',
			gridLinesHtml,
			'<line x1="' + padLeft + '" y1="' + baseY + '" x2="' + (padLeft + chartW) + '" y2="' + baseY + '" class="chart-axis-line" />',
			barsHtml,
			xLabelsHtml,
			'</svg>'
		].join('');

		$wrapper.html(svgHtml);
	}

	function render_opportunity_trends_chart(chart_data) {
		var $wrapper = $('#opportunity-trends-chart-wrapper');
		if (!$wrapper.length || !chart_data) return;

		var labels = chart_data.labels || [];
		var values = (chart_data.datasets && chart_data.datasets[0]) ? chart_data.datasets[0].values : [];

		$wrapper.empty();

		// Check if native Frappe Chart can be used
		if (window.frappe && frappe.Chart) {
			try {
				frappe_opp_chart_instance = new frappe.Chart($wrapper[0], {
					title: "",
					data: {
						labels: labels,
						datasets: [{
							name: __('Opportunity Trends'),
							values: values
						}]
					},
					type: 'bar',
					height: 260,
					colors: ['#f472b6'],
					axisOptions: {
						xIsSeries: true,
						shortenYAxisNumbers: 0
					}
				});
				return;
			} catch (e) {
				console.warn('frappe.Chart fallback to responsive SVG', e);
			}
		}

		// Fallback to high-precision responsive SVG bar chart
		render_svg_opp_chart($wrapper, labels, values);
	}

	function load_opportunity_trends_chart() {
		var timespan = $('#select-opp-chart-timespan').val() || 'Last Quarter';
		var time_interval = $('#select-opp-chart-interval').val() || 'Weekly';

		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_opportunity_trends_chart',
			args: {
				timespan: timespan,
				time_interval: time_interval
			},
			callback: function(r) {
				if (r && r.message) {
					render_opportunity_trends_chart(r.message);
					$('#opp-chart-sync-time').text(__('Last synced just now'));
				}
			}
		});
	}

	// --- WON OPPORTUNITIES CHART ENGINE ---
	var frappe_won_chart_instance = null;

	function render_svg_won_chart($wrapper, labels, values) {
		if (!labels.length) {
			$wrapper.html('<div style="text-align:center; padding: 60px 0; color: #94a3b8; font-size: 13px;">' + __('No won opportunity activity in this period') + '</div>');
			return;
		}

		var w = 1000;
		var h = 280;
		var padLeft = 55;
		var padRight = 25;
		var padTop = 25;
		var padBottom = 45;

		var chartW = w - padLeft - padRight;
		var chartH = h - padTop - padBottom;

		var maxRaw = Math.max.apply(null, values);
		if (maxRaw <= 0) maxRaw = 1;
		var maxY = (maxRaw <= 2) ? 1 : Math.ceil(maxRaw);

		var numPoints = labels.length;
		var baseY = padTop + chartH;
		var barW = Math.max(16, Math.min(38, (chartW / numPoints) * 0.55));

		// Generate horizontal grid lines
		var gridLinesHtml = '';
		var ySteps = [0, 0.5, 1];
		if (maxY > 2) {
			ySteps = [0, 0.25, 0.5, 0.75, 1];
		}
		ySteps.forEach(function(step) {
			var yVal = (maxY <= 2 && step === 0.5) ? '0.5' : Math.round(maxY * step);
			var yPos = padTop + chartH - (step * chartH);
			gridLinesHtml += '<line x1="' + padLeft + '" y1="' + yPos + '" x2="' + (padLeft + chartW) + '" y2="' + yPos + '" class="chart-grid-line" />';
			gridLinesHtml += '<text x="' + (padLeft - 12) + '" y="' + (yPos + 4) + '" text-anchor="end" class="chart-axis-text">' + yVal + '</text>';
		});

		// Generate bars and labels
		var barsHtml = '';
		var xLabelsHtml = '';
		var stepSkip = Math.max(1, Math.floor(numPoints / 14));

		for (var i = 0; i < numPoints; i++) {
			var px = padLeft + (numPoints > 1 ? (i / (numPoints - 1)) * chartW : chartW / 2);
			var val = values[i] || 0;
			var barH = maxY > 0 ? (val / maxY) * chartH : 0;
			var barY = baseY - barH;

			if (val > 0) {
				barsHtml += '<rect x="' + (px - barW / 2).toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + barW + '" height="' + barH.toFixed(1) + '" fill="#f472b6" rx="2" ry="2" class="chart-bar"><title>' + labels[i] + ': ' + val + ' Won Opportunities</title></rect>';
			}

			if (i % stepSkip === 0 || i === numPoints - 1) {
				xLabelsHtml += '<text x="' + px.toFixed(1) + '" y="' + (baseY + 22) + '" text-anchor="middle" class="chart-axis-text">' + labels[i] + '</text>';
			}
		}

		var svgHtml = [
			'<svg class="svg-chart-svg" viewBox="0 0 ' + w + ' ' + h + '">',
			gridLinesHtml,
			'<line x1="' + padLeft + '" y1="' + baseY + '" x2="' + (padLeft + chartW) + '" y2="' + baseY + '" class="chart-axis-line" />',
			barsHtml,
			xLabelsHtml,
			'</svg>'
		].join('');

		$wrapper.html(svgHtml);
	}

	function render_won_opportunities_chart(chart_data) {
		var $wrapper = $('#won-opportunities-chart-wrapper');
		if (!$wrapper.length || !chart_data) return;

		var labels = chart_data.labels || [];
		var values = (chart_data.datasets && chart_data.datasets[0]) ? chart_data.datasets[0].values : [];

		$wrapper.empty();

		// Check if native Frappe Chart can be used
		if (window.frappe && frappe.Chart) {
			try {
				frappe_won_chart_instance = new frappe.Chart($wrapper[0], {
					title: "",
					data: {
						labels: labels,
						datasets: [{
							name: __('Won Opportunities'),
							values: values
						}]
					},
					type: 'bar',
					height: 260,
					colors: ['#f472b6'],
					axisOptions: {
						xIsSeries: true,
						shortenYAxisNumbers: 0
					}
				});
				return;
			} catch (e) {
				console.warn('frappe.Chart fallback to responsive SVG', e);
			}
		}

		// Fallback to high-precision responsive SVG bar chart
		render_svg_won_chart($wrapper, labels, values);
	}

	function load_won_opportunities_chart() {
		var timespan = $('#select-won-chart-timespan').val() || 'Last Year';
		var time_interval = $('#select-won-chart-interval').val() || 'Monthly';

		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_won_opportunities_chart',
			args: {
				timespan: timespan,
				time_interval: time_interval
			},
			callback: function(r) {
				if (r && r.message) {
					render_won_opportunities_chart(r.message);
					$('#won-chart-sync-time').text(__('Last synced just now'));
				}
			}
		});
	}

	// --- TERRITORY WISE OPPORTUNITY CHART ENGINE (DONUT) ---
	var frappe_territory_chart_instance = null;

	function render_svg_donut_chart($wrapper, labels, values) {
		if (!labels.length || !values.length) {
			$wrapper.html('<div style="text-align:center; padding: 60px 0; color: #94a3b8; font-size: 13px;">' + __('No territory data available') + '</div>');
			return;
		}

		var total = values.reduce(function(a, b) { return a + b; }, 0) || 1;
		var palette = ['#bae6fd', '#93c5fd', '#60a5fa', '#38bdf8', '#818cf8', '#a78bfa'];
		var cx = 150, cy = 95, r = 52, strokeW = 26;

		var pathsHtml = '';
		if (values.length === 1) {
			pathsHtml = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + palette[0] + '" stroke-width="' + strokeW + '" />';
		} else {
			var curAngle = -90;
			values.forEach(function(val, idx) {
				var sliceAngle = (val / total) * 360;
				var startA = curAngle * Math.PI / 180;
				var endA = (curAngle + sliceAngle) * Math.PI / 180;
				var x1 = cx + r * Math.cos(startA);
				var y1 = cy + r * Math.sin(startA);
				var x2 = cx + r * Math.cos(endA);
				var y2 = cy + r * Math.sin(endA);
				var largeArc = sliceAngle > 180 ? 1 : 0;
				var d = 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2);
				var color = palette[idx % palette.length];
				pathsHtml += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + strokeW + '" stroke-linecap="butt"><title>' + labels[idx] + ': ' + val + '</title></path>';
				curAngle += sliceAngle;
			});
		}

		var legendHtml = '<div class="chart-legend-box">';
		labels.forEach(function(lbl, idx) {
			var color = palette[idx % palette.length];
			legendHtml += '<div style="margin-right: 14px;"><span class="legend-color-dot" style="background:' + color + ';"></span> <span style="font-size:11.5px; color:#475569; display:block; margin-top:2px;">' + values[idx] + '</span></div>';
		});
		legendHtml += '</div>';

		var svgHtml = [
			'<div class="donut-pie-container">',
			'  <svg viewBox="0 0 300 190" style="width: 100%; max-width: 220px; height: auto; display: block; margin: 0 auto;">',
			pathsHtml,
			'  </svg>',
			legendHtml,
			'</div>'
		].join('');

		$wrapper.html(svgHtml);
	}

	function render_territory_chart(chart_data) {
		var $wrapper = $('#territory-chart-wrapper');
		if (!$wrapper.length || !chart_data) return;

		var labels = chart_data.labels || [];
		var values = (chart_data.datasets && chart_data.datasets[0]) ? chart_data.datasets[0].values : [];

		$wrapper.empty();

		if (window.frappe && frappe.Chart) {
			try {
				frappe_territory_chart_instance = new frappe.Chart($wrapper[0], {
					title: "",
					data: {
						labels: labels,
						datasets: [{
							name: __('Territory'),
							values: values
						}]
					},
					type: 'donut',
					height: 230,
					colors: ['#bae6fd', '#93c5fd', '#60a5fa', '#38bdf8']
				});
				return;
			} catch (e) {
				console.warn('frappe.Chart donut fallback to SVG', e);
			}
		}

		render_svg_donut_chart($wrapper, labels, values);
	}

	function load_territory_chart() {
		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_territory_wise_opportunity_chart',
			callback: function(r) {
				if (r && r.message) {
					render_territory_chart(r.message);
					$('#territory-chart-sync-time').text(__('Last synced just now'));
				}
			}
		});
	}

	// --- OPPORTUNITIES VIA CAMPAIGNS CHART ENGINE (PIE) ---
	var frappe_campaigns_chart_instance = null;

	function render_svg_pie_chart($wrapper, labels, values) {
		if (!labels.length || !values.length) {
			$wrapper.html('<div style="text-align:center; padding: 60px 0; color: #94a3b8; font-size: 13px;">' + __('No campaign data available') + '</div>');
			return;
		}

		var total = values.reduce(function(a, b) { return a + b; }, 0) || 1;
		var palette = ['#bae6fd', '#93c5fd', '#60a5fa', '#38bdf8', '#818cf8', '#a78bfa'];
		var cx = 150, cy = 95, r = 58;

		var pathsHtml = '';
		if (values.length === 1) {
			pathsHtml = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + palette[0] + '" />';
		} else {
			var curAngle = -90;
			values.forEach(function(val, idx) {
				var sliceAngle = (val / total) * 360;
				var startA = curAngle * Math.PI / 180;
				var endA = (curAngle + sliceAngle) * Math.PI / 180;
				var x1 = cx + r * Math.cos(startA);
				var y1 = cy + r * Math.sin(startA);
				var x2 = cx + r * Math.cos(endA);
				var y2 = cy + r * Math.sin(endA);
				var largeArc = sliceAngle > 180 ? 1 : 0;
				var d = 'M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z';
				var color = palette[idx % palette.length];
				pathsHtml += '<path d="' + d + '" fill="' + color + '"><title>' + labels[idx] + ': ' + val + '</title></path>';
				curAngle += sliceAngle;
			});
		}

		var legendHtml = '<div class="chart-legend-box">';
		labels.forEach(function(lbl, idx) {
			var color = palette[idx % palette.length];
			legendHtml += '<div style="margin-right: 14px;"><span class="legend-color-dot" style="background:' + color + ';"></span> <span style="font-size:11.5px; color:#475569; display:block; margin-top:2px;">' + values[idx] + '</span></div>';
		});
		legendHtml += '</div>';

		var svgHtml = [
			'<div class="donut-pie-container">',
			'  <svg viewBox="0 0 300 190" style="width: 100%; max-width: 220px; height: auto; display: block; margin: 0 auto;">',
			pathsHtml,
			'  </svg>',
			legendHtml,
			'</div>'
		].join('');

		$wrapper.html(svgHtml);
	}

	function render_campaigns_chart(chart_data) {
		var $wrapper = $('#campaigns-chart-wrapper');
		if (!$wrapper.length || !chart_data) return;

		var labels = chart_data.labels || [];
		var values = (chart_data.datasets && chart_data.datasets[0]) ? chart_data.datasets[0].values : [];

		$wrapper.empty();

		if (window.frappe && frappe.Chart) {
			try {
				frappe_campaigns_chart_instance = new frappe.Chart($wrapper[0], {
					title: "",
					data: {
						labels: labels,
						datasets: [{
							name: __('Campaigns'),
							values: values
						}]
					},
					type: 'pie',
					height: 230,
					colors: ['#bae6fd', '#93c5fd', '#60a5fa', '#38bdf8']
				});
				return;
			} catch (e) {
				console.warn('frappe.Chart pie fallback to SVG', e);
			}
		}

		render_svg_pie_chart($wrapper, labels, values);
	}

	function load_campaigns_chart() {
		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_opportunities_via_campaigns_chart',
			callback: function(r) {
				if (r && r.message) {
					render_campaigns_chart(r.message);
					$('#campaigns-chart-sync-time').text(__('Last synced just now'));
				}
			}
		});
	}

	// Fetch real-world CRM counts from backend
	function load_crm_data() {
		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_crm_summary',
			callback: function(r) {
				var data = (r && r.message) ? r.message : {
					new_leads: 0,
					new_opportunities: 0,
					won_opportunities: 0,
					open_opportunities: 0
				};
				render_crm_data(data);
			}
		});

		// Refresh all CRM charts
		load_incoming_leads_chart();
		load_opportunity_trends_chart();
		load_won_opportunities_chart();
		load_territory_chart();
		load_campaigns_chart();
	}

	// Show Live indicator in page header
	page.set_indicator(__('Live'), 'green');

	// Initial real data fetch on page load
	load_crm_data();

	// Secondary action: Refresh real data
	page.set_secondary_action(__('Refresh'), function() {
		load_crm_data();
	}, 'refresh');

	// Chart filter change handlers
	$(page.main).on('change', '#select-chart-timespan, #select-chart-interval', function() {
		load_incoming_leads_chart();
	});

	$(page.main).on('click', '#btn-chart-refresh', function() {
		load_incoming_leads_chart();
	});

	$(page.main).on('change', '#select-opp-chart-timespan, #select-opp-chart-interval', function() {
		load_opportunity_trends_chart();
	});

	$(page.main).on('click', '#btn-opp-chart-refresh', function() {
		load_opportunity_trends_chart();
	});

	$(page.main).on('change', '#select-won-chart-timespan, #select-won-chart-interval', function() {
		load_won_opportunities_chart();
	});

	$(page.main).on('click', '#btn-won-chart-refresh', function() {
		load_won_opportunities_chart();
	});

	$(page.main).on('click', '#btn-territory-refresh', function() {
		load_territory_chart();
	});

	$(page.main).on('click', '#btn-campaigns-refresh', function() {
		load_campaigns_chart();
	});

	// --- REAL-TIME ENGINE ---
	// 1. Listen to real-time events via Frappe WebSockets (Socket.IO)
	frappe.realtime.on('crm_dashboard_update', function() {
		load_crm_data();
	});

	frappe.realtime.on('doc_update', function(data) {
		if (data && (data.doctype === 'Lead' || data.doctype === 'Opportunity')) {
			load_crm_data();
		}
	});

	// 2. Real-time auto-polling interval (every 8 seconds)
	var live_timer = setInterval(function() {
		if ($('.g2-crm-dashboard').length) {
			load_crm_data();
		} else {
			clearInterval(live_timer);
		}
	}, 8000);

	// 3. Real-time auto-refresh when window/tab regains focus
	$(window).on('focus.crm_dashboard', function() {
		if ($('.g2-crm-dashboard').length) {
			load_crm_data();
		}
	});

	// Clean up listeners when navigating away from the page
	wrapper.addEventListener('remove', function() {
		clearInterval(live_timer);
		frappe.realtime.off('crm_dashboard_update');
		$(window).off('focus.crm_dashboard');
		$(page.main).off('change', '#select-chart-timespan, #select-chart-interval');
		$(page.main).off('click', '#btn-chart-refresh');
		$(page.main).off('change', '#select-opp-chart-timespan, #select-opp-chart-interval');
		$(page.main).off('click', '#btn-opp-chart-refresh');
		$(page.main).off('change', '#select-won-chart-timespan, #select-won-chart-interval');
		$(page.main).off('click', '#btn-won-chart-refresh');
		$(page.main).off('click', '#btn-territory-refresh');
		$(page.main).off('click', '#btn-campaigns-refresh');
	});
};