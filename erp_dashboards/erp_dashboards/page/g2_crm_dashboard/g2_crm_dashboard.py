import frappe
from frappe.utils import add_months, nowdate


@frappe.whitelist()
def get_crm_summary():
	"""
	Fetch CRM dashboard counts matching standard ERPNext CRM Number Cards:
	1. New Lead (Last 1 Month)
	2. New Opportunity (Last 1 Month)
	3. Won Opportunity (Last 1 Month)
	4. Open Opportunity
	"""
	summary = {
		"new_leads": 0,
		"new_opportunities": 0,
		"won_opportunities": 0,
		"open_opportunities": 0,
	}

	card_mapping = {
		"new_leads": "New Lead (Last 1 Month)",
		"new_opportunities": "New Opportunity (Last 1 Month)",
		"won_opportunities": "Won Opportunity (Last 1 Month)",
		"open_opportunities": "Open Opportunity",
	}

	one_month_ago = add_months(nowdate(), -1)

	for key, card_name in card_mapping.items():
		fetched = False
		# 1. Try to fetch from standard Number Card doc if present
		try:
			if frappe.db.exists("Number Card", card_name):
				from frappe.desk.doctype.number_card.number_card import get_result
				card_doc = frappe.get_doc("Number Card", card_name)
				res = get_result(card_doc.name)
				if res is not None:
					summary[key] = int(float(res))
					fetched = True
		except Exception:
			pass

		if fetched:
			continue

		# 2. Fallback to direct database counts with standard ERPNext CRM filters
		try:
			if key == "new_leads" and frappe.db.table_exists("Lead"):
				summary[key] = frappe.db.count("Lead", filters={"creation": [">=", one_month_ago]})
			elif key == "new_opportunities" and frappe.db.table_exists("Opportunity"):
				summary[key] = frappe.db.count("Opportunity", filters={"creation": [">=", one_month_ago]})
			elif key == "won_opportunities" and frappe.db.table_exists("Opportunity"):
				summary[key] = frappe.db.count(
					"Opportunity",
					filters=[
						["Opportunity", "status", "in", ["Converted", "Closed", "Won"]],
						["Opportunity", "modified", ">=", one_month_ago],
					],
				)
			elif key == "open_opportunities" and frappe.db.table_exists("Opportunity"):
				summary[key] = frappe.db.count("Opportunity", filters={"status": "Open"})
		except Exception as e:
			frappe.log_error(f"CRM Dashboard {key} Error", str(e))

	return summary
