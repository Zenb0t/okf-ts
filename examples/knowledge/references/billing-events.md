---
type: Reference
title: Billing Events
description: Contract for normalized subscription billing events consumed by finance metrics.
resource: bigquery://finance/billing_events
tags:
  - billing
  - source
status: stable
---
# Contract

Each row represents the current recurring amount and lifecycle state of one subscription. The dataset feeds [Monthly Recurring Revenue](../metrics/monthly-recurring-revenue.md).
