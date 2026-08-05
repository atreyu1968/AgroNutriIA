<p align="center">
  <img src="artifacts/agronutri/public/logo.png" alt="AgroNutri AI" width="360" />
</p>

# AgroNutri AI

Plataforma de fertirrigación y sanidad vegetal para fincas de platanera (Canarias): analíticas de suelo, foliar y agua, programas de abonado con IA, calculadora de fertirrigación, técnico virtual (chat con adjuntos y fichas de producto), gestión de fitosanitarios e informes técnicos en PDF/Word. Incluye aplicación web (instalable como PWA) y app móvil.

## Funcionalidades

### Fincas y sectores
- Gestión de fincas con datos agronómicos (cultivo, variedad, superficie, plantas, riego semanal, CE máxima, drenaje, aplicación foliar) y persona de contacto (nombre, teléfono y email).
- División de la finca en sectores con sus propios datos de plantas, superficie, riego y fase fenológica.
- Panel de resumen con el estado agronómico de la finca y avisos.
- Miembros por finca con roles (propietario, técnico, etc.) y permisos según rol.

### Analíticas
- Registro de analíticas de suelo, foliar y agua, con parámetros, laboratorio y fecha de muestreo.
- Ámbito global de la finca o por sector, con selección del ámbito al darlas de alta.
- Importación asistida: sube el PDF del laboratorio y la IA extrae los parámetros.
- El PDF original del laboratorio se guarda junto a la analítica y puede consultarse en cualquier momento desde su detalle ("Ver PDF del laboratorio").
- **Motor de problemas agronómicos**: cruza las analíticas de suelo, foliar y agua de la finca (respetando el sector elegido) y detecta desequilibrios (calcio bloqueado por sodio/magnesio, pH alcalino, salinidad, sodio del agua por SAR/RAS, alcalinidad residual, etc.), cada uno con su recomendación. Es la única fuente de reglas compartida entre la web y el asistente IA, y su resultado se muestra como avisos en el panel de la finca.

### Nutrición y calculadora
- Calculadora de fertirrigación: plan de abonado semanal con dosis por fertilizante, estimación de CE y de nutrientes aportados, y avisos de compatibilidad entre productos.
- CE objetivo ajustable en la propia calculadora, con opción de guardar en la finca los parámetros usados (plantas, riego semanal y CE máxima).
- Contraste automático del plan con los rangos orientativos de N y K₂O de la fase fenológica; el técnico puede modular esos rangos por fase desde la ficha de la finca (y restaurar los orientativos cuando quiera).
- Programas de abonado con estados (borrador, aprobado, activo…) y flujo de aprobación; al guardar un programa manual es obligatoria una justificación técnica, que después se recoge en los informes.
- Borrador de programa generado por IA a partir de las últimas analíticas, para toda la finca o para un sector concreto, respetando los rangos de la fase (orientativos o del técnico).
- Opción de acidificación del agua: si se usa ácido para bajar el pH de riego, la IA calcula los litros de ácido necesarios por semana a partir del pH, los bicarbonatos y el volumen de riego (si faltan datos, usa estimaciones prudentes y lo advierte). Se puede elegir el ácido (nítrico, fosfórico o sulfúrico) o dejar que la IA elija el más adecuado justificando la elección; si no se marca el uso de ácido, el programa solo puede incluir ácidos como fuente de nutrientes, con aviso para que el técnico lo verifique.

### Técnico virtual (IA)
- Chat con un técnico agrónomo virtual con el contexto de la finca (analíticas, sectores, programa vigente).
- Adjuntos en el chat (fotos y documentos) para consultas sobre síntomas o etiquetas.
- Clave de IA propia por usuario u organización, con elección de proveedor (OpenAI, Mistral o DeepSeek) y de modelo, cambio de proveedor de una clave ya guardada, registro de consumo y límite mensual de gasto.
- Aviso en Ajustes de las funciones no disponibles según el proveedor elegido (búsqueda web para fitosanitarios, análisis de imágenes).

### Fitosanitarios
- Catálogo de productos fitosanitarios (número de registro, materia activa, plaga objetivo, plazos de seguridad), con actualización de fichas asistida por IA y ordenación por columnas.
- División automática de fichas que agrupan varios nombres comerciales, individual o en lote.
- Registro de aplicaciones fitosanitarias por sector: producto, dosis, volumen de caldo, superficie y plazo de seguridad.
- Aviso de productos con registro caducado.

### Fertilizantes
- Catálogo de fertilizantes (sólidos y líquidos, fertirrigación y enmiendas) con riqueza y compatibilidades, usado por la calculadora y por la IA.

### Informes
- Informes técnicos en PDF y Word con los datos de la finca, analíticas y programa de abonado, con resumen redactado por IA y logo personalizable.
- Sección de contraste con los rangos de la fase fenológica: compara los aportes de N y K₂O del programa con los rangos aplicados (orientativos o modulados por el técnico), explica su procedencia y, si el programa queda fuera de rango, recoge el motivo de la justificación técnica.
- Informe de enmiendas del terreno con dos escenarios (arranque y siembra, época de lluvias), redactado por IA a partir de las analíticas.
- Revisión automática de coherencia agronómica antes de entregar cada informe (detecta contradicciones típicas, como recomendar caliza en suelos alcalinos).

### Administración y seguridad
- Gestión de usuarios por el administrador (alta, cambio de contraseña, desactivación); registro público desactivable.
- Recuperación de contraseña por email (Resend) con enlaces de un solo uso.
- Registro de auditoría de las acciones importantes.
- Panel de consumo de IA por usuario y operación.
- Copias de seguridad de la base de datos desde el panel de administración.
- Modo demostración (`DEMO_MODE=true`): cuenta de invitado limitada (sin acceso a administración) y topes de uso para instalaciones de prueba.

### Venta y facturación (instalación central)
- Alta de cooperativas/OPP con pago por PayPal (suscripción) y aprovisionamiento automático de su instalación en un subdominio propio.
- Facturación automática mensual de los cargos variables (cuota + importe por finca activa), con numeración correlativa y factura en PDF.
- Facturación electrónica VeriFactu: registro encadenado de facturas con huella, envío a la AEAT y verificación periódica de la cadena.
- Panel central de instalaciones: estado, uso reportado por cada instalación y gestión de cobros.

### Aplicaciones
- **Web** (React + Vite): instalable como PWA en el móvil o el escritorio.
- **Móvil** (Expo): funcionalidades a la par de la web, con bloqueo biométrico opcional (huella / Face ID). Incluye gestión completa de fincas y sectores, analíticas (alta, edición, borrado, filtro por sector y tendencias), programas de abonado con flujo de aprobación y estados, catálogo de fertilizantes y fitosanitarios con plan en PDF, chat con el técnico virtual (conversaciones y borrador de programa desde la respuesta), calculadora con guardado del plan y descarga de informes.

## Estructura del proyecto

Monorepo pnpm:

| Ruta | Contenido |
|---|---|
| `artifacts/api-server` | API (Express + Node.js), servicio en producción |
| `artifacts/agronutri` | Web (React + Vite) |
| `artifacts/agronutri-movil` | App móvil (Expo) |
| `lib/api-spec` | Especificación OpenAPI y generación de código |
| `lib/db` | Esquema de base de datos (Drizzle + PostgreSQL) |
| `deploy/` | Instalador para servidores propios |

## Instalación desatendida en un servidor Ubuntu

El script `deploy/install.sh` deja la aplicación funcionando en un servidor Ubuntu (20.04, 22.04 o 24.04) **totalmente pelado**: no hace falta tener nada actualizado ni instalado previamente. Solo necesitas acceso root (sudo) y conexión a internet.

El script instala y configura automáticamente:

- Actualización del sistema y utilidades básicas (git, curl, compiladores)
- Node.js 24 y pnpm
- PostgreSQL (crea la base de datos y un usuario con contraseña aleatoria)
- El código desde GitHub, dependencias y compilación de API y web
- El esquema de la base de datos
- La API como servicio del sistema (`systemd`), con reinicio automático
- nginx sirviendo la web y haciendo de proxy hacia la API
- Secretos generados automáticamente en `/etc/agronutri/api.env`

### Pasos

1. Conéctate al servidor por SSH.

2. Actualiza el servidor e instala `git` y `curl` (necesarios para descargar el instalador y el código):

   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git curl
   ```

3. Descarga el instalador (aún no hace falta clonar todo el repositorio):

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/atreyu1968/AgroNutriIA/main/deploy/install.sh
   ```

4. Ejecútalo como root, indicando la URL del repositorio y, opcionalmente, tu dominio:

   ```bash
   sudo bash install.sh https://github.com/atreyu1968/AgroNutriIA.git midominio.com
   ```

   Si no indicas dominio, la web responderá en la IP del servidor.

   Durante la instalación el script te pedirá:
   - **Correo y contraseña del administrador** (crea la cuenta con la que entrarás a la app).
   - **Clave de API de Resend** (opcional): activa la recuperación de contraseña por email. Puedes obtenerla gratis en [resend.com](https://resend.com); si la omites, la app funciona igual pero los enlaces de recuperación solo aparecerán en los logs del servidor.

   Para una instalación 100 % desatendida (sin preguntas), pasa los valores por variables de entorno:

   ```bash
   sudo ADMIN_EMAIL=admin@midominio.com ADMIN_PASSWORD='MiClaveSegura1' \
        RESEND_API_KEY=re_xxx EMAIL_FROM='AgroNutri <no-reply@midominio.com>' \
        bash install.sh https://github.com/atreyu1968/AgroNutriIA.git midominio.com
   ```

5. Al terminar, abre `https://midominio.com` (o `https://IP-del-servidor`) y entra con la cuenta de administrador que definiste durante la instalación. El registro público queda desactivado en el servidor: es el administrador quien crea las cuentas desde **Administración → Usuarios** (también puede cambiarles la contraseña o desactivarlas). Si quieres permitir que cualquiera se registre, pon `PUBLIC_REGISTRATION=true` en `/etc/agronutri/api.env` y reinicia la API.

6. Dentro de la app, en **Ajustes**, añade tu clave de IA (OpenAI, Mistral o DeepSeek) para activar el técnico virtual, el chat con adjuntos y los borradores de programa por IA. Algunas funciones requieren un proveedor concreto (la verificación de fitosanitarios necesita OpenAI; el análisis de fotos y PDF escaneados no está disponible con DeepSeek); la propia pantalla de Ajustes lo indica.

> Si el repositorio es privado, usa una URL con token de acceso
> (`https://TOKEN@github.com/atreyu1968/AgroNutriIA.git`) o configura antes una clave SSH de despliegue.

### Opciones avanzadas

Variables de entorno que puedes exportar antes de ejecutar el instalador:

| Variable | Por defecto | Descripción |
|---|---|---|
| `APP_DIR` | `/opt/agronutri` | Directorio de instalación |
| `API_PORT` | `3001` | Puerto interno de la API (solo accesible desde el propio servidor) |
| `GIT_REF` | `main` | Rama o etiqueta a desplegar |

### Operación del servidor

```bash
# Estado y logs de la API
systemctl status agronutri-api
journalctl -u agronutri-api -f

# Reiniciar la API
sudo systemctl restart agronutri-api

# Actualizar a la última versión publicada en GitHub (no pide nada:
# reutiliza toda la configuración existente)
sudo bash /opt/agronutri/deploy/update.sh
```

Para actualizar usa siempre `deploy/update.sh`: descarga la última versión, aplica los cambios de base de datos, recompila y reinicia los servicios **sin pedir nada** (conserva la cuenta de administrador, las sesiones, el túnel de Cloudflare y el resto de la configuración). El instalador `install.sh` también es re-ejecutable, pero está pensado para la primera instalación o para cambiar la configuración (dominio, túnel, credenciales). Antes de aplicar cambios de esquema hace una copia de seguridad automática de la base de datos en `/var/backups/agronutri` (si aun así quieres restaurar: `pg_restore -d agronutri fichero.dump`). Ten en cuenta que la actualización sincroniza el esquema automáticamente; si una versión nueva elimina columnas o tablas, esos datos concretos se pierden — de ahí la copia previa.


### Recuperación de contraseña por email

La app incluye recuperación de contraseña ("¿Has olvidado tu contraseña?" en la pantalla de acceso). El usuario recibe por email un enlace que caduca en 1 hora y solo puede usarse una vez; al restablecerla, se cierran todas sus sesiones abiertas.

Requiere estas variables en `/etc/agronutri/api.env` (el instalador las rellena si le diste la clave):

| Variable | Descripción |
|---|---|
| `RESEND_API_KEY` | Clave de API de [Resend](https://resend.com) |
| `EMAIL_FROM` | Remitente, p. ej. `AgroNutri <no-reply@midominio.com>` (el dominio debe estar verificado en Resend; sin él se usa el remitente de pruebas, que solo entrega al correo de tu propia cuenta de Resend) |
| `APP_URL` | URL pública de la app, usada en los enlaces del email |

Tras cambiar estas variables: `sudo systemctl restart agronutri-api`.

### HTTPS

El instalador configura HTTPS siempre:

- **Con dominio**: emite automáticamente un certificado gratuito de Let's Encrypt (renovación automática incluida). El dominio debe apuntar al servidor antes de ejecutar el instalador.
- **Sin dominio (acceso por IP)**: genera un certificado autofirmado. El navegador mostrará un aviso de seguridad la primera vez, pero el tráfico va cifrado. Cuando tengas dominio, vuelve a ejecutar el instalador pasándolo como segundo argumento.

Todo el tráfico HTTP se redirige a HTTPS y las cookies de sesión se envían solo por conexiones seguras.

## Ficheros y rutas en el servidor

| Ruta | Contenido |
|---|---|
| `/opt/agronutri` | Código de la aplicación |
| `/etc/agronutri/api.env` | Variables de entorno de la API (secretos) |
| `/etc/systemd/system/agronutri-api.service` | Servicio de la API |
| `/etc/nginx/sites-available/agronutri` | Configuración web |
| `/opt/agronutri/artifacts/api-server/storage/reports` | Informes PDF/DOCX generados |
| `/opt/agronutri/artifacts/api-server/storage/analyses` | PDFs originales de laboratorio de las analíticas |

## Desarrollo local

```bash
pnpm install
# API (requiere DATABASE_URL, SESSION_SECRET y PORT)
pnpm --filter @workspace/api-server run dev
# Web
pnpm --filter @workspace/agronutri run dev
# Tests de la API
pnpm --filter @workspace/api-server run test
```
