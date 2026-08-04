---
name: Analítica de agua y unidades
description: Reglas durables sobre mezcla de fuentes de agua y manejo de unidades en el engine
---
- Al promediar o computar parámetros de analíticas de agua, **las unidades deben coincidir o el parámetro se omite con aviso**; nunca promediar µS/cm con dS/m ni mg/L con meq/L.
- **Why:** promediar valores en unidades distintas da resultados absurdos silenciosos que acaban en programas de abonado erróneos.
- **How to apply:** consumidores del agua de la finca usan la mezcla ponderada de fuentes (no la última analítica directa) y propagan sus notas a los warnings visibles/persistidos; los cálculos dependientes de unidad del engine solo aceptan valores normalizados a mg/L.
