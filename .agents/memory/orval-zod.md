---
name: Orval codegen quirks
description: Orval 8 zod version pinning and Params type collisions
---
- Orval 8 emits zod-v4 syntax (e.g. `zod.int()`) even when the workspace has zod 3.x. **Why:** default target changed in Orval 8. **How to apply:** set `override.zod.version: 3` in `lib/api-spec/orval.config.ts`.
- Operations with BOTH path and query params generate a `<Op>Params` type in two places and collide (TS2308). **How to apply:** avoid query params on operations that also take path params, or filter client-side.
