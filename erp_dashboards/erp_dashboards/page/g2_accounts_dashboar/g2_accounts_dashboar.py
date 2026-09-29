import frappe


@frappe.whitelist()
def get_dashboard_summary():
	"""
	Fetch summary totals in DH for:
	- Total Outgoing Bills (Purchase Invoices)
	- Total Incoming Bills (Sales Invoices)
	- Total Incoming Payments (Payment Entry: Receive)
	- Total Outgoing Payments (Payment Entry: Pay)
	"""
	summary = {
		"total_outgoing_bills": 0.0,
		"total_incoming_bills": 0.0,
		"total_incoming_payment": 0.0,
		"total_outgoing_payment": 0.0,
	}

	try:
		if frappe.db.table_exists("Purchase Invoice"):
			result = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(base_grand_total), SUM(grand_total), 0) AS total
				FROM `tabPurchase Invoice`
				WHERE docstatus = 1
				""",
				as_dict=True,
			)
			summary["total_outgoing_bills"] = float(result[0].total) if result and result[0].total else 0.0

		if frappe.db.table_exists("Sales Invoice"):
			result = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(base_grand_total), SUM(grand_total), 0) AS total
				FROM `tabSales Invoice`
				WHERE docstatus = 1
				""",
				as_dict=True,
			)
			summary["total_incoming_bills"] = float(result[0].total) if result and result[0].total else 0.0

		if frappe.db.table_exists("Payment Entry"):
			res_receive = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(base_received_amount), SUM(paid_amount), 0) AS total
				FROM `tabPayment Entry`
				WHERE payment_type = 'Receive' AND docstatus = 1
				""",
				as_dict=True,
			)
			summary["total_incoming_payment"] = (
				float(res_receive[0].total) if res_receive and res_receive[0].total else 0.0
			)

			res_pay = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(base_paid_amount), SUM(paid_amount), 0) AS total
				FROM `tabPayment Entry`
				WHERE payment_type = 'Pay' AND docstatus = 1
				""",
				as_dict=True,
			)
			summary["total_outgoing_payment"] = float(res_pay[0].total) if res_pay and res_pay[0].total else 0.0
	except Exception as e:
		frappe.log_error("Accounts Dashboard Error", str(e))

	return summary
