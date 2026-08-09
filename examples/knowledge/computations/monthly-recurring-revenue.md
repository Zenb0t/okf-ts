---
type: Attested Computation
title: Monthly Recurring Revenue Computation
description: Computes monthly recurring revenue from normalized billing events.
tags:
  - finance
  - sql
sources:
  - id: billing-events
    resource: ../references/billing-events.md
    title: Billing events contract
generated:
  by: process:finance-pipeline
  at: 2026-08-09T12:00:00Z
verified:
  by: process:finance-quality-check
  at: 2026-08-09T12:05:00Z
status: stable
runtime: SQL
parameters:
  - name: as_of_date
    type: DATE
    required: true
executor:
  resource: bigquery://finance/monthly_recurring_revenue
  receipt:
    - monthly_recurring_revenue
attester:
  resource: process:finance-quality-check
---
# Purpose

This computation produces [Monthly Recurring Revenue](../metrics/monthly-recurring-revenue.md) for a reporting date.

# Computation

```sql
select
  sum(monthly_recurring_amount) as monthly_recurring_revenue
from finance.billing_events
where event_date <= @as_of_date
  and status = 'active'
```
