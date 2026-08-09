---
type: Metric
title: Monthly Recurring Revenue
description: Recurring revenue recognized for active subscriptions in a calendar month.
tags:
  - finance
  - saas
sources:
  - id: billing-events
    resource: ../references/billing-events.md
    title: Billing events contract
    usage_count: 1
    last_modified: 2026-08-09
generated:
  by: process:finance-pipeline
  at: 2026-08-09T12:00:00Z
verified:
  by: human:finance-reviewer
  at: 2026-08-09T12:10:00Z
status: stable
stale_after: 2027-08-09
---
# Definition

Monthly Recurring Revenue is the sum of normalized recurring subscription amounts for active subscriptions.

# Governance

Recognition follows the [Revenue Recognition policy](../policies/revenue-recognition.md). The value is produced by the [attested computation](../computations/monthly-recurring-revenue.md).
