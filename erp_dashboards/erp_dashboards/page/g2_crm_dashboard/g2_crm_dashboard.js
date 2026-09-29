frappe.pages['g2-crm-dashboard'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('CRM Dashboard'),
		single_column: true
	});

	// Mark wrapper with full-width helper class
	$(wrapper).addClass('full-width-page');

	// Render CRM dashboard HTML template into page.main
	var template = frappe.templates['g2-crm-dashboard'] || frappe.templates['g2_crm_dashboard'];
	if (template) {
		$(frappe.render_template(template, {})).appendTo(page.main);
	}
};