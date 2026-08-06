---
name: Unificación de unidades al consumir
description: Alcance decidido por el usuario para normalizar unidades: en el punto de consumo/cálculo, no migrar datos guardados
---

El usuario eligió el alcance de unificación de unidades: **unificar en el punto de consumo/cálculo**, no migrar los datos guardados. El pH es un parámetro **sin unidad** (si no indica unidad, sabemos que es pH).

**Why:** decidido explícitamente por el usuario al responder la pregunta de alcance; el objetivo es evitar problemas en cálculos, p. ej. no tratar el pH como algo con unidad.
**How to apply:** normalizar unidades al calcular (p. ej. CE → dS/m en el motor, mg/L para bicarbonatos/alcalinidad), y tratar pH como adimensional. No crear un cambio de esquema/migración para reescribir valores guardados.
