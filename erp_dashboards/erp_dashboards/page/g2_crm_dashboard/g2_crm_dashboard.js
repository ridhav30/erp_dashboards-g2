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

		// Also refresh incoming leads chart
		load_incoming_leads_chart();
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
	});
};