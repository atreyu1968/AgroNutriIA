---
name: billing_charges status semantics
description: Two flows share billing_charges.status; PayPal collection is correlated by invoiced_at/paypal_sale_id, not by status alone
---
`billing_charges.status` ("pending|invoiced|paid") is written by TWO independent flows: manual invoice issuance (admin Facturación) and the PayPal variable-fee sweeper.

**Rule:** PayPal collection state is defined by `invoiced_at` (set only when the subscription revise succeeded) and `paypal_sale_id` (sale that settled it). Manual invoicing sets status="invoiced" but leaves `invoiced_at` NULL.

**Why:** a code review found that keying on status alone lets a manually issued invoice block the PayPal sweep, and lets a base-only PAYMENT.SALE.COMPLETED settle charges never charged through PayPal.

**How to apply:** any new code touching billing_charges must keep this correlation: sweep eligibility = closed period + `invoiced_at IS NULL` + status != 'paid'; webhook settlement requires `invoiced_at < payment time` and dedupes by sale id; amounts are immutable once status != 'pending' (setWhere guard in upsertMonthlyCharge).
