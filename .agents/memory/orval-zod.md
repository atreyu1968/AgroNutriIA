---
name: Orval codegen quirks
description: Orval 8 zod version pinning and Params type collisions
---
- Orval 8 emits zod-v4 syntax (e.g. `zod.int()`) even when the workspace has zod 3.x. **Why:** default target changed in Orval 8. **How to apply:** set `override.zod.version: 3` in `lib/api-spec/orval.config.ts`.
- Generated React Query hooks require an explicit `queryKey` whenever you pass `query` options (e.g. `enabled`). **How to apply:** always pair `enabled` with `queryKey: get<Op>QueryKey(...)` from the generated client.
- Operations with BOTH path and query params generate a `<Op>Params` type in two places and collide (TS2308). **How to apply:** avoid query params on operations that also take path params, or filter client-side.

## Star-export collisions in lib/api-zod/src/index.ts
When an operation gains a requestBody, orval emits both a zod value (generated/api) and a TS type (generated/types) with the same `<Op>Body` name; the index's double `export *` then fails with TS2308. Fix: add the name to the explicit re-export list from "./generated/api" in lib/api-zod/src/index.ts.
