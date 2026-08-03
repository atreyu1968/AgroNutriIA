# AgroNutri AI

Plataforma de fertirrigación para fincas de platanera (Canarias): analíticas de suelo, foliar y agua, programas de abonado, calculadora de fertirrigación, técnico virtual con IA (chat, adjuntos y fichas de producto) e informes técnicos en PDF/Word.

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

2. Descarga el instalador (aún no hace falta clonar todo el repositorio):

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/atreyu1968/AgroNutriIA/main/deploy/install.sh
   ```

3. Ejecútalo como root, indicando la URL del repositorio y, opcionalmente, tu dominio:

   ```bash
   sudo bash install.sh https://github.com/atreyu1968/AgroNutriIA.git midominio.com
   ```

   Si no indicas dominio, la web responderá en la IP del servidor.

4. Al terminar, abre `http://midominio.com` (o `http://IP-del-servidor`) y crea tu usuario desde **Registro**.

5. Dentro de la app, en **Ajustes**, añade tu clave de OpenAI para activar el técnico virtual, el chat con adjuntos y los borradores de programa por IA.

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

# Actualizar a la última versión publicada en GitHub
sudo bash /opt/agronutri/deploy/install.sh https://github.com/atreyu1968/AgroNutriIA.git midominio.com
```

El instalador es **re-ejecutable**: si ya hay una instalación, actualiza el código, vuelve a compilar y reinicia los servicios conservando las credenciales y las sesiones. Antes de aplicar cambios de esquema hace una copia de seguridad automática de la base de datos en `/var/backups/agronutri` (si aun así quieres restaurar: `pg_restore -d agronutri fichero.dump`). Ten en cuenta que la actualización sincroniza el esquema automáticamente; si una versión nueva elimina columnas o tablas, esos datos concretos se pierden — de ahí la copia previa.

### HTTPS (recomendado)

El instalador deja la web en HTTP. Para activar HTTPS con certificado gratuito:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d midominio.com
```

## Ficheros y rutas en el servidor

| Ruta | Contenido |
|---|---|
| `/opt/agronutri` | Código de la aplicación |
| `/etc/agronutri/api.env` | Variables de entorno de la API (secretos) |
| `/etc/systemd/system/agronutri-api.service` | Servicio de la API |
| `/etc/nginx/sites-available/agronutri` | Configuración web |
| `/opt/agronutri/artifacts/api-server/storage/reports` | Informes PDF/DOCX generados |

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
