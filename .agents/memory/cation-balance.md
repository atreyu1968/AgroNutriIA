---
name: Equilibrio catiónico del suelo
description: Reglas compartidas IA+web para diagnosticar calcio bloqueado por Na/Mg y pH alcalino en el abonado.
---
El diagnóstico determinista del equilibrio catiónico vive en `cationBalance.ts` (servidor) y alimenta
por igual el contexto de la IA (borrador y chat) y el aviso automático de la web, vía endpoint
GET /farms/:farmId/analyses/cation-balance. No duplicar estas reglas en el frontend.

Lógica: calcula la saturación de bases (Ca/Mg/K/Na %) desde cationes de cambio en meq/100g; cruza la
foliar con el suelo para distinguir déficit de aporte vs. problema de absorción (Ca foliar bajo +
Ca de suelo disponible ⇒ calcio que no llega; suele deberse a Na%>8 y pH>8). Consecuencia: nitrato
cálcico, evitar sulfato amónico y aportes extra de Mg, K sin cloruros, acidificar el riego (pH 6–6,2),
riegos de lavado.

**Why:** un técnico de finca de platanera reportó que la app no captaba esta cadena de razonamiento;
antes el borrador IA no cruzaba foliar con suelo y podía recomendar sulfato amónico con Ca bloqueado.
**How to apply:** al tocar test de cationes, repetir los casos ambiguos: unidades mixtas (meq y %),
saturación entregada en %, y falsos positivos con parámetros "capacidad"/"catiónico" (el match de
abreviaturas cortas ca/mg/k/na debe ser por token exacto, no por prefijo).
