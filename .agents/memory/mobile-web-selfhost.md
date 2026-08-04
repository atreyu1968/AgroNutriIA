---
name: App móvil como web en servidor propio
description: Cómo se publica la app Expo como web estática en /movil en instalaciones autoalojadas
---

- En el servidor propio (Ubuntu, nginx) la app móvil se publica como export web de Expo en `/movil`:
  `BASE_PATH=/movil expo export --platform web` (app.config.js aplica `experiments.baseUrl` desde BASE_PATH).
- nginx sirve `artifacts/agronutri-movil/dist` con `alias` + fallback SPA a `/movil/index.html`
  (bloques con marcador `agronutri-movil` en install/update/provision, idempotentes en update.sh).
- La API anuncia la URL vía `GET /api/mobile-app`: prioridad `MOBILE_APP_URL` > dominio Expo de Replit >
  `MOBILE_APP_PATH` (+host de la petición). **Why:** sin esto la tarjeta de Ajustes decía «no disponible».
- Detrás de nginx hay que leer `X-Forwarded-Proto/Host` (no `req.protocol`): la conexión local es HTTP y
  saldrían enlaces http:// en sitios HTTPS. Express no tiene `trust proxy` activado.
- En la app móvil, sin `EXPO_PUBLIC_DOMAIN` (caso servidor propio) la base de la API y los enlaces a
  /landing usan `window.location.origin`.

## PWA (añadido después)
La exportación web es PWA instalable: `public/manifest.json`, `public/sw.js` e iconos se copian solos con `expo export`, pero **no** con `scripts/build.js` (static-build de Replit) — por eso build.js tiene `copyPublicAssets()`. El registro del SW y el enlace al manifiesto se inyectan en runtime (`lib/pwa.ts`, `setupPwa()`) deduciendo el base path del `<script src="..._expo/static/...">`, porque la app vive bajo subruta (/movil). Biometría web: WebAuthn platform authenticator (`lib/webBiometric.ts`); el credentialId vive en localStorage. Tras enrolar, `BiometricGate` debe re-evaluar `supported` cuando cambia la preferencia, si no el bloqueo no se activa hasta recargar.
