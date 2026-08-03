#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — instalador desatendido para Ubuntu (20.04/22.04/24.04)
#
# Instala en un servidor "pelado" todo lo necesario y deja la aplicación
# funcionando como servicio: Node.js 24, pnpm, PostgreSQL, nginx, la API
# como servicio systemd y la web compilada servida por nginx.
#
# Uso (como root o con sudo):
#   sudo bash install.sh https://github.com/atreyu1968/AgroNutriIA.git [dominio]
#
#   - 1er argumento (obligatorio): URL del repositorio git.
#   - 2º argumento (opcional): dominio para nginx (por defecto: _ = cualquier host).
#
# Variables opcionales (exportar antes de ejecutar):
#   APP_DIR   Directorio de instalación (por defecto /opt/agronutri)
#   API_PORT  Puerto interno de la API   (por defecto 3001)
#   GIT_REF   Rama o etiqueta a desplegar (por defecto main)
# ============================================================================
set -euo pipefail

REPO_URL="${1:-}"
DOMAIN="${2:-_}"
APP_DIR="${APP_DIR:-/opt/agronutri}"
API_PORT="${API_PORT:-3001}"
GIT_REF="${GIT_REF:-main}"
DB_NAME="agronutri"
DB_USER="agronutri"
SERVICE_NAME="agronutri-api"

if [[ -z "$REPO_URL" ]]; then
  echo "ERROR: falta la URL del repositorio." >&2
  echo "Uso: sudo bash install.sh https://github.com/atreyu1968/AgroNutriIA.git [dominio]" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta este script como root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
log() { echo -e "\n\033[1;32m==> $*\033[0m"; }

# ----------------------------------------------------------------------------
log "Actualizando el sistema e instalando utilidades básicas"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg git build-essential openssl

# ----------------------------------------------------------------------------
log "Instalando Node.js 24 (repositorio NodeSource con clave GPG verificada)"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 22 ]]; then
  # Sin `curl | bash`: se añade el repositorio apt con la clave GPG de
  # NodeSource fijada en un keyring dedicado.
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod 644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
node -v

log "Instalando pnpm (corepack)"
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v

# ----------------------------------------------------------------------------
log "Instalando y arrancando PostgreSQL"
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

log "Creando base de datos y usuario"
# En re-ejecuciones se conservan las credenciales existentes.
if [[ -f /etc/agronutri/api.env ]] && grep -q '^DATABASE_URL=' /etc/agronutri/api.env; then
  DB_PASS="$(grep '^DATABASE_URL=' /etc/agronutri/api.env | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
else
  DB_PASS="$(openssl rand -hex 24)"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

# ----------------------------------------------------------------------------
log "Descargando el código desde GitHub"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all
  git -C "$APP_DIR" checkout "$GIT_REF"
  git -C "$APP_DIR" pull --ff-only origin "$GIT_REF"
else
  git clone --branch "$GIT_REF" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ----------------------------------------------------------------------------
log "Instalando dependencias del proyecto"
pnpm install --frozen-lockfile || pnpm install

# ----------------------------------------------------------------------------
log "Generando secretos y fichero de entorno"
# En re-ejecuciones se conserva el SESSION_SECRET (mantiene las sesiones).
if [[ -f /etc/agronutri/api.env ]] && grep -q '^SESSION_SECRET=' /etc/agronutri/api.env; then
  SESSION_SECRET="$(grep '^SESSION_SECRET=' /etc/agronutri/api.env | cut -d= -f2-)"
else
  SESSION_SECRET="$(openssl rand -hex 32)"
fi
install -d -m 750 /etc/agronutri
cat > /etc/agronutri/api.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
ENV
chmod 640 /etc/agronutri/api.env

# ----------------------------------------------------------------------------
log "Creando/actualizando el esquema de la base de datos"
# Copia de seguridad previa si la base de datos ya tiene contenido.
BACKUP_DIR=/var/backups/agronutri
mkdir -p "$BACKUP_DIR"
if sudo -u postgres psql -d "${DB_NAME}" -tc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | grep -qv '^\s*0\s*$'; then
  sudo -u postgres pg_dump -Fc "${DB_NAME}" > "${BACKUP_DIR}/${DB_NAME}-$(date +%Y%m%d-%H%M%S).dump"
  echo "Copia de seguridad guardada en ${BACKUP_DIR}"
fi
export DATABASE_URL
pnpm --filter @workspace/db run push-force

# ----------------------------------------------------------------------------
log "Compilando la API"
pnpm --filter @workspace/api-server run build

log "Compilando la web"
BASE_PATH=/ PORT=3000 pnpm --filter @workspace/agronutri run build

# ----------------------------------------------------------------------------
log "Creando usuario de sistema y servicio systemd para la API"
id -u agronutri &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin agronutri
mkdir -p "$APP_DIR/artifacts/api-server/storage/reports"
chown -R agronutri:agronutri "$APP_DIR"
chgrp agronutri /etc/agronutri/api.env

cat > /etc/systemd/system/${SERVICE_NAME}.service <<UNIT
[Unit]
Description=AgroNutri AI API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=agronutri
WorkingDirectory=${APP_DIR}/artifacts/api-server
EnvironmentFile=/etc/agronutri/api.env
ExecStart=$(command -v node) --enable-source-maps ./dist/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
# restart (no solo start) para que las re-ejecuciones desplieguen el nuevo build y entorno.
systemctl restart ${SERVICE_NAME}
sleep 2
if ! systemctl is-active --quiet ${SERVICE_NAME}; then
  echo "ERROR: la API no ha arrancado. Últimos logs:" >&2
  journalctl -u ${SERVICE_NAME} -n 30 --no-pager >&2
  exit 1
fi

# ----------------------------------------------------------------------------
log "Instalando y configurando nginx (HTTPS obligatorio)"
apt-get install -y nginx

# Certificado: Let's Encrypt si hay dominio; autofirmado si se instala por IP.
SSL_CERT=""
SSL_KEY=""
if [[ "$DOMAIN" != "_" ]]; then
  apt-get install -y certbot python3-certbot-nginx
  # Certificado real de Let's Encrypt (renovación automática vía systemd timer).
  if certbot certonly --nginx --non-interactive --agree-tos --register-unsafely-without-email -d "$DOMAIN" 2>/dev/null \
     || certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email -d "$DOMAIN"; then
    SSL_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    SSL_KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  else
    echo "AVISO: no se pudo emitir el certificado de Let's Encrypt (¿el dominio apunta a este servidor?)." >&2
    echo "       Se usará un certificado autofirmado; vuelve a ejecutar el instalador cuando el DNS esté listo." >&2
  fi
fi
if [[ -z "$SSL_CERT" ]]; then
  # Autofirmado: el navegador mostrará un aviso, pero la sesión viaja cifrada
  # y las cookies Secure funcionan. Sustituible por certbot cuando haya dominio.
  install -d -m 750 /etc/agronutri/ssl
  if [[ ! -f /etc/agronutri/ssl/selfsigned.crt ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout /etc/agronutri/ssl/selfsigned.key \
      -out /etc/agronutri/ssl/selfsigned.crt \
      -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  fi
  SSL_CERT="/etc/agronutri/ssl/selfsigned.crt"
  SSL_KEY="/etc/agronutri/ssl/selfsigned.key"
fi

cat > /etc/nginx/sites-available/agronutri <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    # Todo el tráfico HTTP se redirige a HTTPS.
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};

    root ${APP_DIR}/artifacts/agronutri/dist/public;
    index index.html;
    client_max_body_size 15m;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/agronutri /etc/nginx/sites-enabled/agronutri
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ----------------------------------------------------------------------------
log "Comprobación final"
sleep 1
HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/api/auth/me" || true)"
if [[ "$HTTP_CODE" =~ ^(200|401)$ ]]; then
  echo "API respondiendo correctamente en el puerto ${API_PORT} (solo accesible desde el servidor)."
else
  echo "ERROR: la API no responde (código ${HTTP_CODE}). Revisa: journalctl -u ${SERVICE_NAME} -n 50" >&2
  exit 1
fi

cat <<FIN

============================================================
 Instalación completada.

 Web:            http://${DOMAIN}/            (o la IP del servidor)
 API (interna):  http://127.0.0.1:${API_PORT}/api
 Código:         ${APP_DIR}
 Entorno API:    /etc/agronutri/api.env
 Servicio:       systemctl status ${SERVICE_NAME}
 Logs API:       journalctl -u ${SERVICE_NAME} -f

 Primer paso: abre la web y crea tu usuario en "Registro".
 La clave de OpenAI se configura después dentro de la app (Ajustes).
============================================================
FIN
