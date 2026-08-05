---
name: Paridad móvil vs web
description: Qué comparte el móvil Expo con la web y qué endpoints faltan, para no re-explorar.
---
La app móvil (artifacts/agronutri-movil) usa el MISMO cliente generado que la web:
`@workspace/api-client-react` (react-query) con `@workspace/api-client-react`/`@workspace/api-zod`.
Base URL absoluta vía `setBaseUrl(EXPO_PUBLIC_DOMAIN ? https://... : window.location.origin)` y
token Bearer desde AsyncStorage (`setAuthTokenGetter`). Todo el CRUD se expone como hooks listos.

Casi todos los endpoints CRUD ya existían en `lib/api-spec/openapi.yaml` y en el cliente:
sectores (create/update/delete), analíticas (create/update/delete/get), recomendaciones
(+`changeRecommendationStatus` con actions submit/approve/reject/start_application/finish y
`createRecommendation`), conversaciones, `createDraftFromMessage`, adjuntos, reportes, fuentes
de agua (set), `calc` (POST /calculations), fertilizantes, fitosanitarios (products+treatments+plan-pdf).
No hizo falta tocar el backend para cerrar las brechas del móvil salvo nada destacable.

Excepción: **renombrar conversación no tiene endpoint** (no existe update/rename en /conversations).
Se omite en móvil hasta que la API lo exponga.

**Why:** el móvil iba a la zaga de la web en varias funciones; se asumió que habría que crear endpoints,
pero la spec ya los tenía — la brecha era de frontend exclusivamente (pantallas solo lectura).
**How to apply:** antes de escribir un endpoint nuevo, grep en el openapi.yaml; en el móvil reutilizar
los hooks generados de @workspace/api-client-react, no crear un cliente paralelo. El preview web de
Expo en Replit dev da error CORS (dominio .expo.spock llama a la API en $REPLIT_DEV_DOMAIN): es
esperado y no una regresión; la app funciona en Expo Go (URL absoluta) o autoservida en /movil
mismo-origen.
