---
name: Seguridad al delegar edits en app/farm/[id]
description: Riesgo de que subagentes generales borren o rompan archivos grandes compartidos del móvil.
---
Al delegar implementaciones del móvil con subagentes de $kind "general", asignar a cada subagente
ARCHIVOS DISJUNTOS. Nunca dos subagentes sobre el mismo archivo grande, y preferir no delegar archivos
que el agente principal también va a editar.

Un subagente general borró accidentalmente `artifacts/agronutri-movil/app/farm/[id]/index.tsx`
(~1350 líneas) al intentar un patch. Se restauró con `git checkout -- <ruta>` y se rehicieron los
edits del agente principal (se pierden los no commiteados). Antes de delegar, dejar los cambios del
agente principal commiteados o ser consciente de que se pueden perder.

**Why:** los subagentes con el patrón leer-todo-y-reescribir pueden destruir ficheros grandes que
comparten con el main agent; el móvil concentra toda una pantalla en un único archivo.
**How to apply:** por pantalla, un solo agente; avisar explícitamente en la tarea "no borres el
archivo, edítalo con Edit"; tras delegación, `git status` + `git checkout` si algo desapareció, y
typecheck final del paquete móvil (npx tsc --noEmit) para detectar roturas.
