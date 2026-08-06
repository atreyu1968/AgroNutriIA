---
name: pH estimado de la solución de riego
description: Modelo determinista de pH estimado en runEngine (engine.ts) y regla de "no fabricar"
---

`runEngine` devuelve `waterPh` (pH medido del agua, sin unidad) y `estimatedWaterPh` (pH estimado de la solución con la abonada).

Regla principal: **nunca fabricar un pH sin datos de agua**. `estimatedWaterPh` solo se calcula cuando la analítica tiene pH Y alcalinidad/bicarbonatos en mg/L; si falta alguno devuelve null y añade un warning.

Modelo: el N amoniacal+uréico acidifica (nitrificación 1 mol N-NH4 → ~2 mol H+), factor orientativo reducido 0,5 meq H+/meq N para ventana corta de fertirrigación. El agua tampona (alcalinidad/50 o HCO3/61 → meq/L). Desplazamiento logarítmico `min(1.3, log10(1+coverage)*0.9)`, acotado a pH 4.0–9.5.

**Why:** la pregunta de método de pH de la calculadora quedó sin respuesta; se eligió el enfoque conservador y transparente en vez de inventar química. En una semana el tampón domina: la acidificación de un programa normal apenas mueve el pH (covertura ~meq/L frente a meq/L de tampón), que es lo correcto.
**How to apply:** el frontend (web calculadora.tsx, móvil calculator.tsx) muestra el pH estimado con etiqueta "con esta abonada (agua X)"; sin estimación muestra "pH del agua (sin ajustar)". No cambiar el modelo sin revisar la regla de no-fabricar.
