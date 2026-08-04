---
name: Normalización de unidades de CE
description: La CE llega en µS/cm, mS/cm o dS/m según laboratorio/usuario; política de normalización a dS/m en toda la app.
---

**Regla:** toda CE (conductividad) se normaliza a dS/m antes de usarla en cálculos o de enviarla a la IA. Valores > 10 sin unidad fiable se interpretan como µS/cm (÷1000); > 10000 se descartan como inválidos.

**Why:** una finca real tenía `maxEcDsM = 1400` (µS/cm tecleados como dS/m). Ese valor crudo llegó al prompt de la IA y al motor, generando planes de abonado disparatados y justificaciones absurdas ("CE máxima admisible 1400 dS/m").

**How to apply:** usar `normalizeMaxEc` (engine) para la CE máxima de finca en motor, borrador IA y contexto; las CE de analíticas enviadas a la IA se anotan con su equivalencia en dS/m (contextBlock). El frontend avisa (no auto-convierte) si el usuario teclea CE > 10 al calcular o guardar. Nunca asumir que un dato numérico configurado por el usuario está en la unidad esperada: normalizar o rechazar con mensaje claro.
