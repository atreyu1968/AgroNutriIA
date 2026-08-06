---
name: Acidificación y bloques de tanque
description: Decisiones de diseño para el cálculo de acidificación independiente y bloques de mezcla (NPK/Calcio/Ácido).
---

El motor de abonado (`engine.ts`) soporta acidificación independiente y agrupación en bloques por tanque.

- Tipos de ácido permitidos: **nítrico y sulfúrico**, nunca cítrico (preferencia del técnico). El cítrico no existe.
- La acidificación se inyecta **aparte del tanque de abonado**; su CE se suma a `estimatedEcDsM` con el aviso de CE máxima (no solo a pH).
- Bloques de mezcla: `npk` (tanque principal), `calcio` (tanque separado, nunca con fosfatos/sulfatos) y `acido` (inyección independiente). Se devuelven en `blocks` y se guardan en cada ítem de recomendación vía `RecommendationItem.block`.
- **Ácido nítrico como producto del programa** (aporte de N/nutriente, no la inyección de acidificación): va SIEMPRE al bloque `calcio`. Solo la inyección independiente (`acid` del motor) queda en su bloque `acido`. Detección en el motor por nombre normalizado (accent-stripped) `acido` + `nitrico`.

**Why:** decisión confirmada por el técnico: no usan ácido cítrico bajo ningún concepto; el calcio debe ir siempre en tanque aparte para evitar precipitados; y el N nítrico aplicado como aporte se mezcla con la línea de calcio.

**How to apply:** al tocar la acidificación o los bloques, mantener solo nítrico/sulfúrico; preservar `block` al guardar/actualizar recomendaciones desde web y móvil.
