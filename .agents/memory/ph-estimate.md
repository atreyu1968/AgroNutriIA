---
name: pH estimado de la solución de riego
description: Modelo determinista de pH estimado en runEngine (engine.ts) y regla de "no fabricar"
---

`runEngine` devuelve `waterPh` (pH medido del agua, sin unidad) y `estimatedWaterPh` (pH estimado de la solución con la abonada).

Regla base: **nunca fabricar un pH sin datos de agua**. `estimatedWaterPh` se calcula cuando la analítica tiene pH Y alcalinidad/bicarbonatos en mg/L; si falta el tampón pero hay corrección de ácido con `targetPh`, se orienta hacia ese objetivo (acotado 4.5–waterPh) con warning; sin pH devuelve null.

Modelo: el N amoniacal+uréico acidifica (nitrificación 1 mol N-NH4 → ~2 mol H+), factor orientativo reducido 0,5 meq H+/meq N para ventana corta de fertirrigación. El agua tampona (alcalinidad/50 o HCO3/61 → meq/L). Desplazamiento logarítmico `min(1.3, log10(1+coverage)*0.9)`, acotado a pH 4.0–9.5. Con tampón, la acidificación de un programa normal apenas mueve el pH, que es lo correcto.

**Why:** pedido explícito del técnico: aunque el agua no tenga bicarbonatos, si se establece una corrección de ácido con objetivo debe salir el pH final de la solución orientado a él (no quedarse en "pH del agua sin ajustar"). La excepción del tampón se marcó con warning para no ocultar que el dato falta.
**How to apply:** el frontend (web calculadora.tsx, móvil calculator.tsx) muestra el pH estimado con etiqueta "con esta abonada (agua X)"; sin estimación muestra "pH del agua (sin ajustar)". No cambiar el modelo sin revisar la regla de no-fabricar.
