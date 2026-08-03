---
name: API tests and shared app_settings
description: Concurrency rule for node --test files that mutate global app_settings rows
---

Node's `node --test` runs each test file in its own process **concurrently**, but they all share the same dev database. Any two test files that mutate the same global rows (e.g. `app_settings` keys like `resend_api_key`/`email_from`) will race and flake.

**Why:** a new test file for the test-email endpoint raced with the existing email-settings test file — one saw the other's saved key and cleanup, causing intermittent failures only in the full suite.

**How to apply:** put all tests that mutate a given global setting in the SAME test file (tests within a file run sequentially). Per-file `process.env` and `globalThis.fetch` mocking is safe (own process); shared DB rows are not.
