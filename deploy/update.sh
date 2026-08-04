#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — script de actualización para servidores ya instalados
#
# Actualiza el código desde GitHub, aplica los cambios de la base de datos,
# recompila la API y la web y reinicia los servicios. NO pide nada: reutiliza
# toda la configuración existente (/etc/agronutri/api.env, nginx, túnel, etc.).
# La cuenta de administrador, las sesiones y los datos no se tocan.
#
# Uso (como root o con sudo):
#   sudo bash /opt/agronutri/deploy/update.sh
#
# Variables opcionales:
#   APP_DIR   Directorio de instalación (por defecto /opt/agronutri)
#   GIT_REF   Rama o etiqueta a desplegar (por defecto main)
# ============================================================================
set -euo pipefail

# Todo el script vive dentro de main() y se invoca en la última línea.
# Así bash lo carga COMPLETO en memoria antes de ejecutar nada: si el
# "git reset --hard" de dentro reescribe este mismo fichero, la ejecución
# en curso no se ve afectada (evita errores por mezclar versiones).
main() {

APP_DIR="${APP_DIR:-/opt/agronutri}"
GIT_REF="${GIT_REF:-main}"
DB_NAME="agronutri"
SERVICE_NAME="agronutri-api"
ENV_FILE="/etc/agronutri/api.env"

log() { echo -e "\n\033[1;32m==> $*\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta este script como root (sudo)." >&2
  exit 1
fi
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "ERROR: no hay una instalación en $APP_DIR. Usa install.sh para instalar." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: falta $ENV_FILE (configuración de la API). Usa install.sh." >&2
  exit 1
fi

# ----------------------------------------------------------------------------
log "Actualizando el código desde GitHub (rama ${GIT_REF})"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"
git fetch origin "$GIT_REF"
git reset --hard "origin/$GIT_REF"

# ----------------------------------------------------------------------------
log "Instalando dependencias"
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@10.26.1 --activate >/dev/null 2>&1 || true
pnpm install --frozen-lockfile || pnpm install
pnpm rebuild esbuild @swc/core >/dev/null 2>&1 || true

# ----------------------------------------------------------------------------
log "Actualizando el esquema de la base de datos (con copia de seguridad previa)"
BACKUP_DIR=/var/backups/agronutri
mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump -Fc "${DB_NAME}" > "${BACKUP_DIR}/${DB_NAME}-$(date +%Y%m%d-%H%M%S).dump"
echo "Copia de seguridad guardada en ${BACKUP_DIR}"
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
export DATABASE_URL
pnpm --filter @workspace/db run push-force

# Catálogo base de fertilizantes: solo se carga si el catálogo está vacío
# (no pisa productos añadidos o editados por el usuario).
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$APP_DIR/deploy/seed-fertilizers.sql"

# ----------------------------------------------------------------------------
# La compilación de la web necesita bastante memoria; misma red de seguridad
# que en install.sh (swap + heap ampliado) para servidores pequeños.
TOTAL_MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ "$TOTAL_MEM_MB" -lt 3000 && "$SWAP_MB" -lt 512 ]]; then
  log "Poca memoria detectada (${TOTAL_MEM_MB} MB): creando swap de 2 GB"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
export NODE_OPTIONS="--max-old-space-size=2048"

log "Compilando la API"
pnpm --filter @workspace/api-server run build

log "Compilando la web"
BASE_PATH=/ PORT=3000 \
  VITE_DEMO_URL="${DEMO_URL:-}" \
  VITE_DEMO_EMAIL="${DEMO_EMAIL:-}" \
  VITE_DEMO_PASSWORD="${DEMO_PASSWORD:-}" \
  pnpm --filter @workspace/agronutri run build

# ----------------------------------------------------------------------------
# Cabeceras de caché de la PWA en instalaciones ya desplegadas: si el sitio de
# nginx no las tiene todavía, se insertan antes del "location /". Idempotente
# (marcador "agronutri-cache"); así los navegadores reciben la versión nueva
# sin borrar la caché tras cada actualización.
log "Comprobando cabeceras de caché en nginx"
for site in /etc/nginx/sites-available/agronutri*; do
  [[ -f "$site" ]] || continue
  grep -q 'agronutri-cache' "$site" && continue
  awk '
    !done && $0 ~ /^[[:space:]]*location \/ \{/ {
      print "    # --- agronutri-cache: cabeceras de caché de la PWA ---"
      print "    location = /index.html {"
      print "        add_header Cache-Control \"no-cache, must-revalidate\";"
      print "    }"
      print "    location = /sw.js {"
      print "        add_header Cache-Control \"no-cache, must-revalidate\";"
      print "    }"
      print "    location = /registerSW.js {"
      print "        add_header Cache-Control \"no-cache, must-revalidate\";"
      print "    }"
      print "    location = /manifest.webmanifest {"
      print "        add_header Cache-Control \"no-cache, must-revalidate\";"
      print "    }"
      print "    location /assets/ {"
      print "        add_header Cache-Control \"public, max-age=31536000, immutable\";"
      print "    }"
      print "    # --- fin agronutri-cache ---"
      done = 1
    }
    { print }
  ' "$site" > "${site}.tmp" && mv "${site}.tmp" "$site"
  echo "  Cabeceras de caché añadidas a ${site}"
done

# ----------------------------------------------------------------------------
log "Reiniciando servicios"
chown -R agronutri:agronutri "$APP_DIR"
systemctl restart "${SERVICE_NAME}"
nginx -t && systemctl reload nginx

sleep 2
if curl -fsS "http://127.0.0.1:$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)/api" >/dev/null 2>&1 \
   || [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)/api")" == "401" ]]; then
  echo "API respondiendo correctamente."
else
  echo "AVISO: la API no responde todavía; revisa: journalctl -u ${SERVICE_NAME} -n 30" >&2
fi

echo
echo "============================================================"
echo " Actualización completada."
echo " Recarga la web en el navegador con Ctrl+Mayús+R."
echo "============================================================"

}
main "$@"
