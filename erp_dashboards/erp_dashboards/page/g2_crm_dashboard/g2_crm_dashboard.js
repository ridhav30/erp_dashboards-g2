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
	}

	// Show Live indicator in page header
	page.set_indicator(__('Live'), 'green');

	// Initial real data fetch on page load
	load_crm_data();

	// Secondary action: Refresh real data
	page.set_secondary_action(__('Refresh'), function() {
		load_crm_data();
	}, 'refresh');

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

	// 2. Real-time auto-polling interval (every 6 seconds)
	var live_timer = setInterval(function() {
		if ($('.g2-crm-dashboard').length) {
			load_crm_data();
		} else {
			clearInterval(live_timer);
		}
	}, 6000);

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
	});
};