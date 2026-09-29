import frappe
from frappe.utils import add_months, nowdate


@frappe.whitelist()
def get_crm_summary():
	"""
	Fetch exact real-world CRM counts matching standard ERPNext CRM Number Cards:
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
		"new_leads": ["New Lead (Last 1 Month)", "New Leads (Last 1 Month)", "New Leads"],
		"new_opportunities": ["New Opportunity (Last 1 Month)", "New Opportunities (Last 1 Month)", "New Opportunities"],
		"won_opportunities": ["Won Opportunity (Last 1 Month)", "Won Opportunities (Last 1 Month)", "Won Opportunities"],
		"open_opportunities": ["Open Opportunity", "Open Opportunities", "Active Opportunities"],
	}

	one_month_ago = add_months(nowdate(), -1)

	for key, card_names in card_mapping.items():
		fetched = False

		# 1. Fetch from standard ERPNext Number Card doctype
		for card_name in card_names:
			if fetched:
				break
			if not frappe.db.exists("Number Card", card_name):
				continue

			# Try calling Frappe get_result
			try:
				from frappe.desk.doctype.number_card.number_card import get_result
				card_doc = frappe.get_doc("Number Card", card_name)
				for arg in [
					{"doc": card_doc.as_dict()},
					{"name": card_name},
					card_doc.as_dict(),
				]:
					try:
						res = get_result(arg)
						if res is not None:
							val = res.get("value") if isinstance(res, dict) else res
							summary[key] = int(round(float(val)))
							fetched = True
							break
					except Exception:
						continue
			except Exception:
				pass

			# Direct count using Number Card's exact filters_json
			if not fetched:
				try:
					card_doc = frappe.get_doc("Number Card", card_name)
					filters = frappe.parse_json(card_doc.filters_json) if card_doc.filters_json else []
					summary[key] = frappe.db.count(card_doc.document_type, filters=filters)
					fetched = True
				except Exception:
					pass

		if fetched:
			continue

		# 2. Fallback to direct database counts with standard ERPNext CRM filters
		try:
			if key == "new_leads" and frappe.db.table_exists("Lead"):
				cnt = frappe.db.count("Lead", filters={"creation": [">=", one_month_ago]})
				if cnt == 0:
					cnt = frappe.db.count("Lead")
				summary[key] = cnt

			elif key == "new_opportunities" and frappe.db.table_exists("Opportunity"):
				cnt = frappe.db.count("Opportunity", filters={"creation": [">=", one_month_ago]})
				if cnt == 0:
					cnt = frappe.db.count("Opportunity")
				summary[key] = cnt

			elif key == "won_opportunities" and frappe.db.table_exists("Opportunity"):
				cnt = frappe.db.count(
					"Opportunity",
					filters=[
						["Opportunity", "status", "in", ["Converted", "Closed", "Won"]],
						["Opportunity", "modified", ">=", one_month_ago],
					],
				)
				if cnt == 0:
					cnt = frappe.db.count("Opportunity", filters={"status": ["in", ["Converted", "Closed", "Won"]]})
				summary[key] = cnt

			elif key == "open_opportunities" and frappe.db.table_exists("Opportunity"):
				cnt = frappe.db.count("Opportunity", filters={"status": "Open"})
				if cnt == 0:
					cnt = frappe.db.count("Opportunity", filters={"status": ["in", ["Open", "Quotation", "Draft"]]})
				summary[key] = cnt

		except Exception as e:
			frappe.log_error(f"CRM Dashboard {key} Error", str(e))

	return summary
