frappe.pages['g2-accounts-dashboar'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Accounts Dashboard'),
		single_column: true
	});

	// Mark wrapper with full-width helper class
	$(wrapper).addClass('full-width-page');

	// Render speedometer dashboard HTML template into page.main
	var template = frappe.templates['g2-accounts-dashboar'] || frappe.templates['g2_accounts_dashboar'];
	if (template) {
		$(frappe.render_template(template, {})).appendTo(page.main);
	}

	// Format number with commas and 2 decimals
	function format_dh(val) {
		var num = parseFloat(val) || 0;
		return num.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
	}

	// Smoothly count up numbers
	function animate_counter($el, target_val, duration) {
		var start_val = parseFloat($el.attr('data-val') || 0);
		var end_val = parseFloat(target_val) || 0;
		$el.attr('data-val', end_val);

		var start_time = null;
		duration = duration || 1200;

		function step(timestamp) {
			if (!start_time) start_time = timestamp;
			var progress = Math.min((timestamp - start_time) / duration, 1);
			// Ease out quad
			var ease = 1 - (1 - progress) * (1 - progress);
			var current = start_val + (end_val - start_val) * ease;
			$el.text(format_dh(current));

			if (progress < 1) {
				window.requestAnimationFrame(step);
			} else {
				$el.text(format_dh(end_val));
			}
		}
		window.requestAnimationFrame(step);
	}

	// Set needle rotation and arc stroke
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

	// Animate speedometer gauge & needle to target value
	function set_speedometer_gauge(id_suffix, value, animate_number) {
		var val = parseFloat(value) || 0;

		// Calculate dynamic scale
		var max_val = 100000;
		if (val > 80000) {
			max_val = Math.ceil((val * 1.25) / 50000) * 50000;
		}

		var pct = max_val > 0 ? Math.min(Math.max(val / max_val, 0), 1) : 0;
		var total_arc = 235.62;
		var dashoffset = total_arc * (1 - pct);
		var angle = -90 + (pct * 180);

		var $card = $('#card-' + id_suffix);

		// Animate needle and arc
		apply_needle_rotation($card, angle, dashoffset);

		// Update max scale label
		var max_label = (max_val >= 1000000)
			? (max_val / 1000000).toFixed(1) + 'M DH'
			: (max_val / 1000).toFixed(0) + 'K DH';
		$('#max-' + id_suffix).text(max_label);

		// Animate or set number display
		var $val_el = $('#kpi-' + id_suffix + '-val');
		if (animate_number !== false) {
			animate_counter($val_el, val);
		} else {
			$val_el.text(format_dh(val));
		}
	}

	// Perform startup self-test sweep animation (needle sweeps up and settles)
	function startup_gauge_sweep(data) {
		var keys = ['outgoing-bills', 'incoming-bills', 'incoming-payment', 'outgoing-payment'];
		var sweep_angles = [45, 60, 30, 50]; // energetic startup sweep

		// Step 1: Sweep needle forward
		keys.forEach(function(key, idx) {
			var $card = $('#card-' + key);
			apply_needle_rotation($card, sweep_angles[idx], 100);
		});

		// Step 2: Settle to real values after 650ms
		setTimeout(function() {
			set_speedometer_gauge('outgoing-bills', data.total_outgoing_bills);
			set_speedometer_gauge('incoming-bills', data.total_incoming_bills);
			set_speedometer_gauge('incoming-payment', data.total_incoming_payment);
			set_speedometer_gauge('outgoing-payment', data.total_outgoing_payment);
		}, 700);
	}

	var current_data = {
		total_outgoing_bills: 0,
		total_incoming_bills: 0,
		total_incoming_payment: 0,
		total_outgoing_payment: 0
	};

	// Load metrics from backend and animate speedometers
	function load_dashboard_kpis() {
		frappe.call({
			method: 'erp_dashboards.erp_dashboards.page.g2_accounts_dashboar.g2_accounts_dashboar.get_dashboard_summary',
			callback: function(r) {
				current_data = (r && r.message) ? r.message : {
					total_outgoing_bills: 0,
					total_incoming_bills: 0,
					total_incoming_payment: 0,
					total_outgoing_payment: 0
				};

				startup_gauge_sweep(current_data);
			}
		});
	}

	// Interactive: Click any card to trigger an interactive needle pulse
	$(wrapper).on('click', '.speedometer-card', function() {
		var id = $(this).attr('id');
		if (!id) return;
		var suffix = id.replace('card-', '');
		var $card = $(this);

		// Quick test sweep
		apply_needle_rotation($card, 70, 50);
		setTimeout(function() {
			var field_map = {
				'outgoing-bills': 'total_outgoing_bills',
				'incoming-bills': 'total_incoming_bills',
				'incoming-payment': 'total_incoming_payment',
				'outgoing-payment': 'total_outgoing_payment'
			};
			var val = current_data[field_map[suffix]] || 0;
			set_speedometer_gauge(suffix, val);
		}, 600);
	});

	// Initial load
	load_dashboard_kpis();

	// Secondary action: Refresh
	page.set_secondary_action(__('Refresh'), function() {
		load_dashboard_kpis();
	}, 'refresh');

	// Secondary action: Test Sweep (allows user to see needles sweep on demand)
	page.add_inner_button(__('Test Needles Sweep'), function() {
		startup_gauge_sweep(current_data);
	});

	// Secondary action: Demo Data Preview (if the database currently has 0 records)
	page.add_inner_button(__('Simulate Values'), function() {
		var demo_data = {
			total_outgoing_bills: 68450.00,
			total_incoming_bills: 95200.00,
			total_incoming_payment: 84300.00,
			total_outgoing_payment: 42150.00
		};
		startup_gauge_sweep(demo_data);
	});
};