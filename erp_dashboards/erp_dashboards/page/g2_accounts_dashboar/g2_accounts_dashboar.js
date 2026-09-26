frappe.pages['g2-accounts-dashboar'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Accounts Dashboard'),
		single_column: true
	});

	// Mark wrapper with full-width helper class
	$(wrapper).addClass('full-width-page');

	// Render dashboard HTML template into page.main
	if (frappe.templates['g2-accounts-dashboar']) {
		$(frappe.render_template('g2-accounts-dashboar', {})).appendTo(page.main);
	} else if (frappe.templates['g2_accounts_dashboar']) {
		$(frappe.render_template('g2_accounts_dashboar', {})).appendTo(page.main);
	}
};