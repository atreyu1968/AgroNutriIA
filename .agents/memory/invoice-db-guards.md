---
name: Invoice DB trigger guards
description: Trust model and pitfalls of the PostgreSQL triggers protecting issued invoices.
---

- Issued invoices are protected by DB triggers (block fiscal-field UPDATE, DELETE, and TRUNCATE; only status/sent_at/paid_at/updated_at may change). Installed idempotently at api-server startup, which awaits installation before listening.
- **Why no session-variable bypass:** any `current_setting('app.*')` escape hatch is settable by every session, so it is not a real protection. Test cleanup must instead use `ALTER TABLE … DISABLE TRIGGER` inside a transaction.
- **How to apply:** Replit-managed Postgres uses a single owner role, so DDL bypass is possible by design; document the trust model instead of claiming role separation. Drizzle errors wrap PG errors — assert on `err.cause.message` in tests.
