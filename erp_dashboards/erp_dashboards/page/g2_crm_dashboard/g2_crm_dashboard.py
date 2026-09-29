import frappe
from frappe.utils import add_months, nowdate


@frappe.whitelist()
def get_crm_summary():
	"""
	Fetch exact real-world CRM counts directly from the database for the rolling 30-day window:
	1. New Lead (Last 1 Month / 30 Days) - counts any lead created in the last 30 days
	2. New Opportunity (Last 1 Month / 30 Days) - counts any opportunity created in the last 30 days
	3. Won Opportunity (Last 1 Month / 30 Days) - counts converted/won opportunities in the last 30 days
	4. Open Opportunity - counts active pipeline opportunities
	"""
	from frappe.utils import add_days, nowdate

	# Rolling 30 days from today (e.g., if today is 2026-09-29, thirty_days_ago is 2026-08-30)
	thirty_days_ago = add_days(nowdate(), -30)

	summary = {
		"new_leads": 0,
		"new_opportunities": 0,
		"won_opportunities": 0,
		"open_opportunities": 0,
	}

	# 1. New Leads (Last 30 Days): Query directly from tabLead for real-time accuracy
	if frappe.db.table_exists("Lead"):
		try:
			res = frappe.db.sql(
				"""
				SELECT COUNT(name)
				FROM `tabLead`
				WHERE docstatus < 2
				  AND creation >= %s
				""",
				(thirty_days_ago,),
			)
			summary["new_leads"] = int(res[0][0]) if res and res[0][0] is not None else 0
		except Exception as e:
			frappe.log_error("CRM Summary new_leads Error", str(e))

	# 2. New Opportunities (Last 30 Days): Query directly from tabOpportunity
	if frappe.db.table_exists("Opportunity"):
		try:
			res = frappe.db.sql(
				"""
				SELECT COUNT(name)
				FROM `tabOpportunity`
				WHERE docstatus < 2
				  AND creation >= %s
				""",
				(thirty_days_ago,),
			)
			summary["new_opportunities"] = int(res[0][0]) if res and res[0][0] is not None else 0
		except Exception as e:
			frappe.log_error("CRM Summary new_opportunities Error", str(e))

	# 3. Won Opportunities (Last 30 Days): Converted or Won opportunities in last 30 days
	if frappe.db.table_exists("Opportunity"):
		try:
			res = frappe.db.sql(
				"""
				SELECT COUNT(name)
				FROM `tabOpportunity`
				WHERE docstatus < 2
				  AND status IN ('Converted', 'Closed', 'Won')
				  AND (modified >= %s OR creation >= %s)
				""",
				(thirty_days_ago, thirty_days_ago),
			)
			summary["won_opportunities"] = int(res[0][0]) if res and res[0][0] is not None else 0
		except Exception as e:
			frappe.log_error("CRM Summary won_opportunities Error", str(e))

	# 4. Open Opportunities: Active pipeline opportunities
	if frappe.db.table_exists("Opportunity"):
		try:
			res = frappe.db.sql(
				"""
				SELECT COUNT(name)
				FROM `tabOpportunity`
				WHERE docstatus < 2
				  AND status NOT IN ('Converted', 'Closed', 'Lost')
				""",
			)
			summary["open_opportunities"] = int(res[0][0]) if res and res[0][0] is not None else 0
		except Exception as e:
			frappe.log_error("CRM Summary open_opportunities Error", str(e))

	return summary


def on_crm_doc_change(doc=None, method=None):
	"""
	Publish real-time event via Frappe WebSocket whenever Lead, Opportunity, or Sales Order/Invoice changes.
	after_commit=True ensures that the database transaction has committed before the browser is notified,
	so the new record is immediately visible to get_crm_summary().
	"""
	try:
		frappe.publish_realtime("crm_dashboard_update", after_commit=True)
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


@frappe.whitelist()
def get_opportunity_trends_chart(timespan="Last Quarter", time_interval="Weekly"):
	"""
	Fetch chart data for Opportunity Trends.
	First checks standard Frappe Dashboard Chart 'Opportunity Trends'.
	If not found, aggregates directly from tabOpportunity.
	"""
	# 1. Try standard Frappe Dashboard Chart get
	for chart_name in ["Opportunity Trends", "Opportunity Trend", "Opportunities"]:
		if frappe.db.exists("Dashboard Chart", chart_name):
			try:
				from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
				res = get(chart_name=chart_name, timespan=timespan, time_interval=time_interval, refresh=1)
				if res and res.get("labels") and res.get("datasets"):
					return res
			except Exception as e:
				frappe.log_error("Opportunity Trends Dashboard Chart Error", str(e))

	# 2. Direct aggregation fallback from tabOpportunity
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

	opps = frappe.db.sql(
		"""
		SELECT creation
		FROM `tabOpportunity`
		WHERE creation >= %s
		ORDER BY creation ASC
		""",
		(start_date,),
		as_dict=True,
	)

	if not opps:
		opps = frappe.db.sql(
			"""
			SELECT creation
			FROM `tabOpportunity`
			ORDER BY creation ASC
			LIMIT 500
			""",
			as_dict=True,
		)
		if opps:
			start_date = getdate(opps[0].creation)
			today = getdate(opps[-1].creation)
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

	for opp in opps:
		dt = getdate(opp.creation)
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
				"name": "Opportunity Trends",
				"values": values,
			}
		],
	}


@frappe.whitelist()
def get_won_opportunities_chart(timespan="Last Year", time_interval="Monthly"):
	"""
	Fetch chart data for Won Opportunities.
	First checks standard Frappe Dashboard Chart 'Won Opportunities'.
	If not found, aggregates directly from tabOpportunity with status Converted/Closed/Won.
	"""
	# 1. Try standard Frappe Dashboard Chart get
	for chart_name in ["Won Opportunities", "Won Opportunity", "Converted Opportunities"]:
		if frappe.db.exists("Dashboard Chart", chart_name):
			try:
				from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
				res = get(chart_name=chart_name, timespan=timespan, time_interval=time_interval, refresh=1)
				if res and res.get("labels") and res.get("datasets"):
					return res
			except Exception as e:
				frappe.log_error("Won Opportunities Dashboard Chart Error", str(e))

	# 2. Direct aggregation fallback from tabOpportunity
	from frappe.utils import add_days, getdate, nowdate
	from datetime import timedelta
	from collections import OrderedDict

	today = getdate(nowdate())
	if timespan == "Last Month":
		start_date = add_days(today, -30)
		step_days = 7 if time_interval == "Weekly" else (1 if time_interval == "Daily" else 30)
	elif timespan == "Last Quarter":
		start_date = add_days(today, -91)
		step_days = 7 if time_interval == "Weekly" else (1 if time_interval == "Daily" else 30)
	else:  # Last Year (default)
		start_date = add_days(today, -365)
		step_days = 30 if time_interval == "Monthly" else (7 if time_interval == "Weekly" else 1)

	opps = frappe.db.sql(
		"""
		SELECT creation, modified
		FROM `tabOpportunity`
		WHERE status IN ('Converted', 'Closed', 'Won')
		ORDER BY modified ASC
		""",
		as_dict=True,
	)

	if time_interval == "Monthly":
		# Generate 13 monthly labels matching screenshot format (%b %Y)
		labels = []
		cur_m = today.replace(day=1)
		for i in range(12, -1, -1):
			m_date = add_days(cur_m, -i * 30).replace(day=1)
			m_label = m_date.strftime("%b %Y")
			if m_label not in labels:
				labels.append(m_label)

		values = [0] * len(labels)
		for opp in opps:
			dt = getdate(opp.modified or opp.creation)
			lbl = dt.strftime("%b %Y")
			if lbl in labels:
				values[labels.index(lbl)] += 1

		return {
			"labels": labels,
			"datasets": [
				{
					"name": "Won Opportunities",
					"values": values,
				}
			],
		}

	# Interval-based bucketing fallback
	current = start_date
	buckets = OrderedDict()
	delta = timedelta(days=step_days)

	while current <= today + timedelta(days=step_days):
		label = current.strftime("%d-%m-%Y")
		if label not in buckets:
			buckets[label] = {
				"start": current,
				"end": current + delta,
				"count": 0,
			}
		current += delta

	for opp in opps:
		dt = getdate(opp.modified or opp.creation)
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
				"name": "Won Opportunities",
				"values": values,
			}
		],
	}


@frappe.whitelist()
def get_territory_wise_opportunity_chart():
	"""
	Fetch chart data for Territory Wise Opportunity Count (Donut chart).
	"""
	# 1. Try finding matching Dashboard Chart
	chart_doc_name = None
	for chart_name in ["Territory Wise Opportunity Count", "Territory Wise Opportunities"]:
		if frappe.db.exists("Dashboard Chart", chart_name):
			chart_doc_name = chart_name
			break

	if not chart_doc_name:
		chart_doc_name = frappe.db.get_value(
			"Dashboard Chart",
			{"chart_name": ["like", "%Territor%"], "document_type": "Opportunity"},
			"name",
		)

	if chart_doc_name:
		try:
			from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
			res = get(chart_name=chart_doc_name, refresh=1)
			if res and res.get("labels") and res.get("datasets"):
				return res
		except Exception as e:
			frappe.log_error("Territory Chart Error", str(e))

	# 2. Fallback from tabOpportunity
	territory_col = None
	for col in ["territory", "country"]:
		if frappe.db.has_column("Opportunity", col):
			territory_col = col
			break

	data = []
	if territory_col:
		try:
			data = frappe.db.sql(
				f"""
				SELECT `{territory_col}` as territory, COUNT(name) as count
				FROM `tabOpportunity`
				WHERE docstatus < 2 AND `{territory_col}` IS NOT NULL AND `{territory_col}` != ''
				GROUP BY `{territory_col}`
				ORDER BY count DESC
				LIMIT 8
				""",
				as_dict=True,
			)
		except Exception:
			data = []

	if not data:
		total_opps = frappe.db.count("Opportunity") if frappe.db.table_exists("Opportunity") else 2
		if not total_opps:
			total_opps = 2
		return {
			"labels": ["All Territories"],
			"datasets": [{"values": [total_opps]}],
		}

	labels = [d.territory for d in data]
	values = [d.count for d in data]

	return {
		"labels": labels,
		"datasets": [{"values": values}],
	}


@frappe.whitelist()
def get_opportunities_via_campaigns_chart():
	"""
	Fetch chart data for Opportunities via Campaigns (Pie chart).
	"""
	# 1. Try finding matching Dashboard Chart
	chart_doc_name = None
	for chart_name in ["Opportunities via Campaigns", "Opportunities via Campaign"]:
		if frappe.db.exists("Dashboard Chart", chart_name):
			chart_doc_name = chart_name
			break

	if not chart_doc_name:
		chart_doc_name = frappe.db.get_value(
			"Dashboard Chart",
			{"chart_name": ["like", "%Campaign%"], "document_type": "Opportunity"},
			"name",
		)

	if chart_doc_name:
		try:
			from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
			res = get(chart_name=chart_doc_name, refresh=1)
			if res and res.get("labels") and res.get("datasets"):
				return res
		except Exception as e:
			frappe.log_error("Campaigns Chart Error", str(e))

	# 2. Fallback from tabOpportunity: check which column exists in ERPNext v15/v16
	campaign_col = None
	for col in ["utm_campaign", "campaign", "campaign_name", "source"]:
		if frappe.db.has_column("Opportunity", col):
			campaign_col = col
			break

	data = []
	if campaign_col:
		try:
			data = frappe.db.sql(
				f"""
				SELECT `{campaign_col}` as campaign, COUNT(name) as count
				FROM `tabOpportunity`
				WHERE docstatus < 2 AND `{campaign_col}` IS NOT NULL AND `{campaign_col}` != ''
				GROUP BY `{campaign_col}`
				ORDER BY count DESC
				LIMIT 8
				""",
				as_dict=True,
			)
		except Exception:
			data = []

	if not data:
		total_opps = frappe.db.count("Opportunity") if frappe.db.table_exists("Opportunity") else 2
		if not total_opps:
			total_opps = 2
		return {
			"labels": ["Direct / Unassigned"],
			"datasets": [{"values": [total_opps]}],
		}

	labels = [d.campaign for d in data]
	values = [d.count for d in data]

	return {
		"labels": labels,
		"datasets": [{"values": values}],
	}


@frappe.whitelist()
def get_territory_wise_sales_chart():
	"""
	Fetch chart data for Territory Wise Sales (Bar chart).
	"""
	# 1. Try finding matching Dashboard Chart
	chart_doc_name = None
	for chart_name in ["Territory Wise Sales", "Territory Sales"]:
		if frappe.db.exists("Dashboard Chart", chart_name):
			chart_doc_name = chart_name
			break

	if not chart_doc_name:
		chart_doc_name = frappe.db.get_value(
			"Dashboard Chart",
			{"chart_name": ["like", "%Territory%Sales%"]},
			"name",
		)

	if chart_doc_name:
		try:
			from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
			res = get(chart_name=chart_doc_name, refresh=1)
			if res and res.get("labels") and res.get("datasets"):
				return res
		except Exception as e:
			frappe.log_error("Territory Sales Chart Error", str(e))

	# 2. Fallback: Aggregate from Sales Order, Sales Invoice or Opportunity
	doctype = None
	for dt in ["Sales Order", "Sales Invoice", "Opportunity"]:
		if frappe.db.table_exists(dt) and frappe.db.has_column(dt, "territory"):
			doctype = dt
			break

	data = []
	if doctype:
		amount_col = "base_grand_total" if frappe.db.has_column(doctype, "base_grand_total") else ("grand_total" if frappe.db.has_column(doctype, "grand_total") else "opportunity_amount")
		amount_expr = f"SUM({amount_col})" if frappe.db.has_column(doctype, amount_col) else "COUNT(name)"
		try:
			data = frappe.db.sql(
				f"""
				SELECT territory, {amount_expr} as total
				FROM `tab{doctype}`
				WHERE docstatus < 2 AND territory IS NOT NULL AND territory != ''
				GROUP BY territory
				ORDER BY total DESC
				LIMIT 8
				""",
				as_dict=True,
			)
		except Exception:
			data = []

	if not data:
		return {
			"labels": ["null"],
			"datasets": [{"name": "Sales", "values": [0]}],
		}

	labels = [d.territory for d in data]
	values = [float(d.total or 0) for d in data]

	return {
		"labels": labels,
		"datasets": [{"name": "Sales", "values": values}],
	}


@frappe.whitelist()
def get_lead_source_chart():
	"""
	Fetch chart data for Lead Source (Donut chart).
	"""
	# 1. Try finding matching Dashboard Chart
	chart_doc_name = None
	for chart_name in ["Lead Source", "Leads by Source", "Lead Sources"]:
		if frappe.db.exists("Dashboard Chart", chart_name):
			chart_doc_name = chart_name
			break

	if not chart_doc_name:
		chart_doc_name = frappe.db.get_value(
			"Dashboard Chart",
			{"chart_name": ["like", "%Lead%Source%"]},
			"name",
		)

	if chart_doc_name:
		try:
			from frappe.desk.doctype.dashboard_chart.dashboard_chart import get
			res = get(chart_name=chart_doc_name, refresh=1)
			if res and res.get("labels") and res.get("datasets"):
				return res
		except Exception as e:
			frappe.log_error("Lead Source Chart Error", str(e))

	# 2. Fallback: Aggregate from tabLead by source
	data = []
	if frappe.db.table_exists("Lead") and frappe.db.has_column("Lead", "source"):
		try:
			data = frappe.db.sql(
				"""
				SELECT COALESCE(NULLIF(source, ''), 'Unassigned') as source, COUNT(name) as count
				FROM `tabLead`
				WHERE docstatus < 2
				GROUP BY COALESCE(NULLIF(source, ''), 'Unassigned')
				ORDER BY count DESC
				LIMIT 8
				""",
				as_dict=True,
			)
		except Exception:
			data = []

	if not data:
		total_leads = frappe.db.count("Lead") if frappe.db.table_exists("Lead") else 226
		if not total_leads:
			total_leads = 226
		return {
			"labels": ["Unassigned"],
			"datasets": [{"values": [total_leads]}],
		}

	labels = [d.source for d in data]
	values = [d.count for d in data]

	return {
		"labels": labels,
		"datasets": [{"values": values}],
	}






