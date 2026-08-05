---
name: Motor de problemas de analíticas
description: Arquitectura IA+web que cruza suelo+foliar+agua para detectar desequilibrios, cada uno con su recomendación.
---
Hay un **motor de problemas** en `problems.ts` (servidor) que cruza suelo+foliar+agua y devuelve
`runProblems()` → `{ problems, contextBlock, warnings }`. Es la única fuente de reglas: alimenta por
igual el contexto de la IA (borrador y chat) y el banner web vía endpoint GET /farms/:farmId/analyses/problems.
No duplicar reglas en el frontend.

Cada problema es un *detector* (función `(input) => FertilityProblem[]`) registrado en `DETECTORS`.
Añadir un problema nuevo = escribir un detector y registrarlo; el bloque de contexto IA, el endpoint
y el banner web los genera el motor. `FertilityProblem = { id, severity(info|warning|critical), title, message, advice, sources }`.

Lógica núcleo (desde `cationBalance.ts`): saturación de bases (Ca/Mg/K/Na %) desde cationes de cambio
en meq/100g; cruza foliar y suelo para distinguir déficit de aporte vs. problema de absorción
(Ca foliar bajo + Ca de suelo disponible ⇒ calcio que no llega; suele deberse a Na%>8 y pH>8).
Consecuencia: nitrato cálcico, evitar sulfato amónico y aportes extra de Mg, K sin cloruros, acidificar
el riego (pH 6–6,2), riegos de lavado. Detectores implementados: calcium_absorption, soil_sodium,
water_salinity_limit/tight (usa CE agua vs CE máxima de la finca), soil_ph_alkaline, leaf_<nutriente>
(N/P/K/Fe/Zn/Mn/B por tuplate status/ref), soil_ca_low_saturation y soil_mg_high_saturation.

El prompt maestro del asistente vive en `masterAgronomistPrompt.ts` (texto del técnico agrícola virtual,
15 secciones) y se compone como base de `agronomistSystemPrompt` en `openai.ts`, junto a las reglas
operativas de la app (CE en µS/cm, descuento de aportes del agua, nombres exactos de producto, etc.).

**Why:** un técnico de platanera reportó que la app no captaba la lógica de cruce de analíticas y
podía recomendar sulfato amónico con Ca bloqueado. **How to apply:** al tocar tests, repetir los casos
ambiguos de cationes: unidades mixtas (meq y %), saturación entregada en %, y falsos positivos con
"capacidad"/"catiónico" (match de abreviaturas cortas ca/mg/k/na por token exacto, no por prefijo).
