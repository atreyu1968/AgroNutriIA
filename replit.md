# AgroNutri AI

Plataforma de gestión de fertirrigación para fincas de platanera en Canarias.

## Overview
- **Frontend** (`artifacts/agronutri`): React + Vite + shadcn, UI 100 % en español, wouter routing, TanStack Query with Orval-generated hooks from `@workspace/api-client-react`.
- **Backend** (`artifacts/api-server`): Express 5 + Drizzle + PostgreSQL (Replit-managed). OpenAPI contract in `lib/api-spec/openapi.yaml`; codegen via `pnpm --filter @workspace/api-spec run codegen`.
- **Auth**: local email/password (bcrypt), DB-backed session tokens in HTTP-only cookie `agronutri_session` (30-day TTL).
- **AI**: per-user OpenAI keys, AES-256-GCM encrypted (key derived from `SESSION_SECRET` via scrypt, `src/lib/crypto.ts`), masked in UI; per-farm override via api-config; monthly cost limits enforced.
- **Engine**: deterministic fertigation calculator in `artifacts/api-server/src/lib/engine.ts` (water volume, nutrient kg, EC/SAR estimates, incompatibilities, Spanish warnings).
- **Reports**: PDF (pdfkit) and DOCX (docx) generated synchronously into `artifacts/api-server/storage/reports/`; download route `/api/farms/:farmId/reports/:reportId/download`.
- **Importación de analíticas en PDF**: `POST /api/farms/:farmId/analyses/import` (multipart, multer en memoria, máx. 10 MB, comprueba bytes mágicos `%PDF-`); extrae texto con pdf-parse y usa la clave OpenAI del usuario (resolveCredential) para extraer parámetros validados con zod antes de guardar. Botón "Importar PDF" en la pestaña Analíticas de la finca y en la Calculadora.
- **Admin**: rutas `/api/admin/*` (solo `isAdmin`); página `/administracion`. Credenciales admin: `admin@agronutri.es` / `AdminAgro2026!`. Usuario de ejemplo: `tecnico@agronutri.es` / `tecnico2026`.
- **Seed data**: `artifacts/api-server/src/seed.ts` (run with `npx tsx`). Demo user `demo@agronutri.es` / `agronutri2026` (AGROSABINA SL, finca Bajo Cuadras with real analyses and validated program).

## User preferences
- Communicate with the user in Spanish, non-technical register. No emojis.
- Application UI entirely in Spanish (es-ES).

## Notes
- `pdfkit`/`fontkit` must stay in the esbuild `external` list in `artifacts/api-server/build.mjs` (bundling breaks @swc/helpers resolution).
- Recommendation workflow: draft → pending_review → validated → applying → finished / rejected; approve/reject restricted to owner/technician.
