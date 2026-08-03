---
name: Wouter nested routing
description: Rules for nested Route/base paths in the agronutri web app
---
The web app mounts section routers with `<Route path="/fincas" nest>`. Inside a nested router:
- Child `Route` paths and `useRoute()` patterns are RELATIVE to the base (`/`, `/:id`), never the full `/fincas/:id`.
- `Link href` values also resolve relative to the base; `href={`/fincas/${id}`}` produces `/fincas/fincas/1`. Use relative (`/${id}`) or `~`-prefixed absolute paths.
**Why:** A task-agent merge reintroduced absolute paths inside the nested router and the whole Fincas section rendered blank/404 with no console errors.
**How to apply:** After merges touching pages under a nested router, verify child route patterns, useRoute patterns, and Links are base-relative.
