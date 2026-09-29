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

	// Animate digital counter roll-up
	function animate_odometer($el, target_val, duration) {
		var start_val = Math.round(parseFloat($el.attr('data-val') || 0));
		var end_val = Math.round(parseFloat(target_val || 0));
		$el.attr('data-val', end_val);

		var start_time = null;
		duration = duration || 1200;

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

	// Animate 180° speedometer gauge to target value
	function set_speedometer_gauge(id_suffix, value, animate_number) {
		var val = parseFloat(value) || 0;

		// Gauge scale multiplies in 100K units (100,000 baseline: 100K, 200K, 300K...)
		var max_val = 100000;
		if (val > 100000) {
			max_val = Math.ceil(val / 100000) * 100000;
		}

		var pct = max_val > 0 ? Math.min(Math.max(val / max_val, 0), 1) : 0;
		var total_arc = 235.62;
		var dashoffset = total_arc * (1 - pct);
		var angle = -90 + (pct * 180);

		var $card = $('#card-' + id_suffix);

		// Animate needle and arc
		apply_needle_rotation($card, angle, dashoffset);

		// Update max scale label in 100K increments (e.g. 100K, 200K, 300K, 1M...)
		var max_label;
		if (max_val >= 1000000) {
			var m = max_val / 1000000;
			max_label = (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
		} else {
			max_label = Math.round(max_val / 1000) + 'K';
		}
		$('#max-' + id_suffix).text(max_label);

		// Animate or set count readout
		var $val_el = $('#count-' + id_suffix);
		if (animate_number !== false) {
			animate_odometer($val_el, val);
		} else {
			$val_el.text(format_count(val));
		}
	}

	// Perform startup self-test sweep animation
	function startup_gauge_sweep(data) {
		var keys = ['new-leads', 'new-opportunities', 'won-opportunities', 'open-opportunities'];
		var sweep_angles = [45, 60, 30, 50]; // startup sweep forward

		// Step 1: Sweep needles forward
		keys.forEach(function(key, idx) {
			var $card = $('#card-' + key);
			apply_needle_rotation($card, sweep_angles[idx], 100);
		});

		// Step 2: Settle to real values after 650ms
		setTimeout(function() {
			set_speedometer_gauge('new-leads', data.new_leads);
			set_speedometer_gauge('new-opportunities', data.new_opportunities);
			set_speedometer_gauge('won-opportunities', data.won_opportunities);
			set_speedometer_gauge('open-opportunities', data.open_opportunities);
		}, 700);
	}

	var current_crm_data = {
		new_leads: 0,
		new_opportunities: 0,
		won_opportunities: 0,
		open_opportunities: 0
	};

	// Fetch CRM counts from backend
	function load_crm_data() {
		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_crm_dashboard.g2_crm_dashboard.get_crm_summary',
			callback: function(r) {
				current_crm_data = (r && r.message) ? r.message : {
					new_leads: 0,
					new_opportunities: 0,
					won_opportunities: 0,
					open_opportunities: 0
				};

				startup_gauge_sweep(current_crm_data);
			}
		});
	}

	// Initial fetch
	load_crm_data();

	// Secondary action: Refresh
	page.set_secondary_action(__('Refresh'), function() {
		load_crm_data();
	}, 'refresh');

	// Toolbar action: Rev Gauges (Test sweep)
	page.add_inner_button(__('Rev Gauges'), function() {
		startup_gauge_sweep(current_crm_data);
	});

	// Toolbar action: Simulate Values (demonstrating exact ERPNext CRM counts: 36, 2, 2, 2)
	page.add_inner_button(__('Simulate Counts'), function() {
		var demo_data = {
			new_leads: 36,
			new_opportunities: 2,
			won_opportunities: 2,
			open_opportunities: 2
		};
		startup_gauge_sweep(demo_data);
	});

	// Toolbar action: Simulate 100K Scale (e.g. 150K, 45K, 80K, 120K)
	page.add_inner_button(__('Simulate 100K Scale'), function() {
		var demo_data = {
			new_leads: 150000,
			new_opportunities: 45000,
			won_opportunities: 80000,
			open_opportunities: 120000
		};
		startup_gauge_sweep(demo_data);
	});
};