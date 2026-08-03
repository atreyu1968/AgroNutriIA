---
name: Duplicate toast stores in agronutri web
description: Why toasts can be invisible in the web app and the rule to avoid reintroducing it
---
The web app once had two independent toast stores: `@/components/ui/use-toast` (the one `<Toaster />` in App.tsx renders) and a full shadcn copy in `@/hooks/use-toast`. Pages importing the hooks version fired toasts into a store nothing rendered — silently invisible.

**Why:** a task-agent merge added the second store; both compile fine, so only manual UI testing caught it.

**How to apply:** `@/hooks/use-toast` now just re-exports the components/ui store. Keep a single store; if a merge reintroduces a standalone `src/hooks/use-toast.ts`, collapse it back to a re-export. Also: API client errors are `ApiError` with the server message at `err.data.error` (NOT `err.response.data.error`).
