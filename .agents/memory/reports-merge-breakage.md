---
name: Reports route merge breakage patterns
description: Patrones de corrupción en reports.ts tras merges simultáneos de tareas
---

## Regla

Tras merges simultáneos de varias tareas, `artifacts/api-server/src/routes/reports.ts`
puede presentar estas tres roturas silenciosas:

1. **Parser incorrecto en POST /reports**: La fusión puede sustituir `CreateReportBody.safeParse`
   por `PreviewReportNotesBody.safeParse`. El síntoma es que el endpoint devuelve 400
   aunque el body sea correcto, o acepta bodies inválidos.

2. **INSERT reemplazado por SELECT**: La sección de creación del informe puede quedar como
   un `.select().from(reportsTable).where(eq(reportsTable.id, reportId))` donde `reportId`
   no está declarado, causando `ReferenceError` → Express devuelve HTML 500.
   El correcto es `.insert(reportsTable).values({...}).returning()`.

3. **Variables sin declarar en resolveCredential**: La llamada `resolveCredential(farm, user)`
   dentro del bloque `if (reportType === "enmiendas")` debe ser
   `resolveCredential(access.farm, req.user!)`. Las variables `farm` y `user` se declaran
   DESPUÉS de la respuesta 201 (dentro del cierre async), no antes.

**Why:** Estas tres roturas coexisten porque el bloque de enmiendas y el bloque de creación
del informe están próximos en el fichero y las fusiones automáticas invierten o fusionan
secciones incorrectamente.

**How to apply:** Después de cualquier merge que toque reports.ts, verificar:
- Que el parser sea `CreateReportBody`
- Que haya `.insert(reportsTable).values({...}).returning()` antes del `res.status(201)`
- Que `resolveCredential` reciba `access.farm` y `req.user!`
