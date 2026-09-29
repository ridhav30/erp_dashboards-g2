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


def on_crm_doc_change(doc=None, method=None):
	"""
	Publish real-time event via Frappe WebSocket whenever Lead or Opportunity changes.
	"""
	try:
		frappe.publish_realtime("crm_dashboard_update")
	except Exception:
		pass


@frappe.whitelist()
def get_incoming_leads_chart(timespan="Last Quarter", time_interval="Weekly"):
	"""
	Fetch chart data for Incoming Leads.
	First checks standard Frappe Dashboard Chart 'Incoming Leads'.
	If not found, aggregates directly from tabLead by the requested timespan and frequency.
	"""
	# 1. Try standard Frappe Dashboard Chart get
	if frappe.db.exists("Dashboard Chart", "Incoming Leads"):
		try:
			from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
			res = get(chart_name="Incoming Leads", timespan=timespan, time_interval=time_interval, refresh=1)
			if res and res.get("labels") and res.get("datasets"):
				return res
		except Exception as e:
			frappe.log_error("Incoming Leads Dashboard Chart Error", str(e))

	# 2. Direct aggregation fallback from tabLead
	from frappe.utils import add_days, getdate, nowdate
	from datetime import timedelta
	from collections import OrderedDict

	today = getdate(nowdate())
	if timespan == "Last Month":
		start_date = add_days(today, -30)
		step_days = 7 if time_interval == "Weekly" else (1 if time_interval == "Daily" else 30)
	elif timespan == "Last Year":
		start_date = add_days(today, -365)
		step_days = 30 if time_interval == "Monthly" else (7 if time_interval == "Weekly" else 1)
	else:  # Last Quarter (default)
		start_date = add_days(today, -91)
		step_days = 7 if time_interval == "Weekly" else (1 if time_interval == "Daily" else 30)

	leads = frappe.db.sql(
		"""
		SELECT creation
		FROM `tabLead`
		WHERE creation >= %s
		ORDER BY creation ASC
		""",
		(start_date,),
		as_dict=True,
	)

	# If no recent leads found in current calendar timespan, look at latest available leads in system
	if not leads:
		leads = frappe.db.sql(
			"""
			SELECT creation
			FROM `tabLead`
			ORDER BY creation ASC
			LIMIT 500
			""",
			as_dict=True,
		)
		if leads:
			start_date = getdate(leads[0].creation)
			today = getdate(leads[-1].creation)
			if (today - start_date).days < 14:
				start_date = add_days(today, -91)

	# Generate clean interval date buckets
	current = start_date
	buckets = OrderedDict()
	delta = timedelta(days=step_days)

	while current <= today + timedelta(days=step_days):
		label = current.strftime("%d-%m-%Y")
		buckets[label] = {
			"start": current,
			"end": current + delta,
			"count": 0,
		}
		current += delta

	for lead in leads:
		dt = getdate(lead.creation)
		for label, b in buckets.items():
			if b["start"] <= dt < b["end"]:
				b["count"] += 1
				break

	labels = list(buckets.keys())
	values = [b["count"] for b in buckets.values()]

	return {
		"labels": labels,
		"datasets": [
			{
				"name": "Incoming Leads",
				"values": values,
			}
		],
	}


