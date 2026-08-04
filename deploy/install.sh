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
# Credenciales del administrador (se piden si no vienen por variables de entorno:
# ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME — útiles para instalaciones 100% desatendidas).
if [[ -z "${ADMIN_EMAIL:-}" ]]; then
  read -rp "Correo del administrador: " ADMIN_EMAIL
fi
if [[ ! "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "ERROR: correo no válido: $ADMIN_EMAIL" >&2
  exit 1
fi
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  while true; do
    read -rsp "Contraseña del administrador (mínimo 8 caracteres): " ADMIN_PASSWORD; echo
    if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then echo "Debe tener al menos 8 caracteres."; continue; fi
    read -rsp "Repite la contraseña: " ADMIN_PASSWORD2; echo
    [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] && break
    echo "No coinciden, inténtalo de nuevo."
  done
fi
if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
  echo "ERROR: la contraseña debe tener al menos 8 caracteres." >&2
  exit 1
fi
ADMIN_NAME="${ADMIN_NAME:-Administrador}"

# Clave de Resend para el envío de emails (recuperación de contraseña). Opcional.
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  read -rp "Clave de API de Resend para emails (opcional, Enter para omitir): " RESEND_API_KEY || true
fi
EMAIL_FROM="${EMAIL_FROM:-}"
if [[ -n "$RESEND_API_KEY" && -z "$EMAIL_FROM" ]]; then
  read -rp "Remitente de los emails (p. ej. AgroNutri <no-reply@midominio.com>, Enter para el de pruebas de Resend): " EMAIL_FROM || true
fi

# ----------------------------------------------------------------------------
# Túnel de Cloudflare (opcional): publica la app en Internet con HTTPS sin abrir
# puertos ni necesitar IP pública ni dominio propio en el servidor. Crea el túnel
# en el panel Zero Trust de Cloudflare (Networks > Tunnels), copia el TOKEN del
# conector y, en "Public hostname", apunta el servicio a http://localhost:80.
# Puede darse por variables de entorno para instalaciones desatendidas:
#   CLOUDFLARE_TUNNEL_TOKEN, TUNNEL_HOSTNAME
if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  # Se lee sin eco: el token es una credencial y no debe quedar en pantalla.
  echo "Token del túnel de Cloudflare (opcional). AVISO: se escribe a ciegas, no se muestra nada al teclear ni al pegar; pega el token y pulsa Enter (o pulsa Enter sin más para omitir)."
  read -rsp "Token: " CLOUDFLARE_TUNNEL_TOKEN || true
  echo
fi
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-}"
if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
  # El dominio público es obligatorio con túnel: sin él, los enlaces de email y
  # la comprobación de origen (CSRF/CORS) apuntarían a una URL equivocada.
  while [[ ! "$TUNNEL_HOSTNAME" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; do
    read -rp "Dominio público del túnel (obligatorio, p. ej. agronutri.midominio.com): " TUNNEL_HOSTNAME || true
  done
fi

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
# Se fija la versión de pnpm probada con el proyecto: versiones más nuevas
# pueden ignorar los scripts de compilación permitidos (esbuild, @swc/core).
corepack prepare pnpm@10.26.1 --activate
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
# Salvaguarda: si pnpm hubiese ignorado los scripts de compilación de las
# dependencias nativas (ERR_PNPM_IGNORED_BUILDS), se compilan explícitamente.
pnpm rebuild esbuild @swc/core >/dev/null 2>&1 || true

# ----------------------------------------------------------------------------
log "Generando secretos y fichero de entorno"
# En re-ejecuciones se conserva el SESSION_SECRET (mantiene las sesiones).
if [[ -z "${ALERT_EMAIL:-}" && -f /etc/agronutri/api.env ]]; then
  # Conservar el destinatario de avisos operativos configurado previamente.
  ALERT_EMAIL="$(grep '^ALERT_EMAIL=' /etc/agronutri/api.env | cut -d= -f2- || true)"
fi
if [[ -f /etc/agronutri/api.env ]] && grep -q '^SESSION_SECRET=' /etc/agronutri/api.env; then
  SESSION_SECRET="$(grep '^SESSION_SECRET=' /etc/agronutri/api.env | cut -d= -f2-)"
else
  SESSION_SECRET="$(openssl rand -hex 32)"
fi
if [[ -n "$TUNNEL_HOSTNAME" ]]; then
  # Con túnel de Cloudflare, la URL pública es el dominio del túnel (HTTPS lo
  # aporta Cloudflare en el borde).
  APP_URL="https://${TUNNEL_HOSTNAME}"
elif [[ "$DOMAIN" == "_" ]]; then
  APP_URL="https://$(hostname -I | awk '{print $1}')"
else
  APP_URL="https://${DOMAIN}"
fi
install -d -m 750 /etc/agronutri
cat > /etc/agronutri/api.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
# Registro público desactivado: las cuentas las crea el administrador desde la app.
PUBLIC_REGISTRATION=false
# URL pública (para los enlaces de los emails de recuperación de contraseña).
APP_URL=${APP_URL}
# Envío de emails con Resend (recuperación de contraseña).
RESEND_API_KEY=${RESEND_API_KEY}
EMAIL_FROM=${EMAIL_FROM}
# Destinatario de los avisos operativos (p. ej. fallo del reinicio nocturno
# de la demo, deploy/demo-reset.sh). Opcional; requiere RESEND_API_KEY.
ALERT_EMAIL=${ALERT_EMAIL:-}
# Copias de seguridad de las instalaciones de cooperativas (panel de administración).
BACKUP_SCRIPT=${APP_DIR}/deploy/backup-coop.sh
BACKUP_DIR=/var/backups/agronutri
ENV

# Regla sudoers restringida: el servicio (usuario agronutri) solo puede
# ejecutar el script de copias de seguridad, nada más.
cat > /etc/sudoers.d/agronutri-backup <<SUDOERS
agronutri ALL=(root) NOPASSWD: /usr/bin/bash ${APP_DIR}/deploy/backup-coop.sh *
SUDOERS
chmod 440 /etc/sudoers.d/agronutri-backup
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
log "Creando la cuenta de administrador"
# El hash bcrypt se calcula con la propia dependencia del proyecto.
ADMIN_HASH="$(cd "$APP_DIR/artifacts/api-server" && ADMIN_PASSWORD="$ADMIN_PASSWORD" node -e \
  'require("bcryptjs").hash(process.env.ADMIN_PASSWORD, 10).then(h => process.stdout.write(h))')"
ADMIN_EMAIL_LC="$(echo "$ADMIN_EMAIL" | tr "[:upper:]" "[:lower:]")"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" \
  -v email="$ADMIN_EMAIL_LC" -v hash="$ADMIN_HASH" -v adminname="$ADMIN_NAME" <<'SQL'
INSERT INTO users (email, password_hash, name, role, is_admin)
VALUES (:'email', :'hash', :'adminname', 'owner', true)
ON CONFLICT (email)
DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = true;
SQL
echo "Cuenta de administrador lista: ${ADMIN_EMAIL_LC}"

# ----------------------------------------------------------------------------
log "Compilando la API"
pnpm --filter @workspace/api-server run build

log "Compilando la web"
# Acceso a la cooperativa de pruebas en la landing (opcional): define
# DEMO_URL (p. ej. https://prueba.tudominio.es) y, si quieres mostrar las
# credenciales, DEMO_EMAIL y DEMO_PASSWORD antes de ejecutar este script.
# Para que la demo se reinicie sola cada noche, tras aprovisionarla ejecuta
# "sudo bash deploy/demo-reset.sh setup <sub>" (ver deploy/README.md).
BASE_PATH=/ PORT=3000 \
  VITE_DEMO_URL="${DEMO_URL:-}" \
  VITE_DEMO_EMAIL="${DEMO_EMAIL:-}" \
  VITE_DEMO_PASSWORD="${DEMO_PASSWORD:-}" \
  pnpm --filter @workspace/agronutri run build

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
if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
  log "Instalando y configurando nginx (modo túnel Cloudflare: HTTP local, TLS en el borde)"
else
  log "Instalando y configurando nginx (HTTPS obligatorio)"
fi
apt-get install -y nginx

if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
  # Modo túnel de Cloudflare: nginx sirve la app por HTTP en el puerto 80 (solo
  # accesible por el conector cloudflared). El cifrado HTTPS lo proporciona
  # Cloudflare en su borde, por lo que aquí no hacen falta certificados ni
  # redirección a HTTPS (evita bucles de redirección a través del túnel).
  cat > /etc/nginx/sites-available/agronutri <<NGINX
server {
    # Solo loopback: únicamente el conector cloudflared (local) puede llegar
    # aquí; el puerto 80 no queda expuesto en texto plano hacia la red.
    listen 127.0.0.1:80;
    listen [::1]:80;
    server_name ${TUNNEL_HOSTNAME:-_};

    root ${APP_DIR}/artifacts/agronutri/dist/public;
    index index.html;
    client_max_body_size 15m;

    # Subida de copias de seguridad (ficheros grandes) — solo esta ruta.
    location /api/admin/installations/ {
        client_max_body_size 512m;
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 600s;
        proxy_request_buffering off;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        # Cloudflare entrega la petición original por HTTPS; se propaga para que
        # la app genere URLs y compruebe el origen correctamente.
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
else
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

    # Subida de copias de seguridad (ficheros grandes) — solo esta ruta.
    location /api/admin/installations/ {
        client_max_body_size 512m;
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_request_buffering off;
    }

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
fi
ln -sf /etc/nginx/sites-available/agronutri /etc/nginx/sites-enabled/agronutri
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ----------------------------------------------------------------------------
# Túnel de Cloudflare: instala cloudflared y lo registra como servicio con el
# token del conector. La ruta pública (hostname -> http://localhost:80) se
# configura en el panel Zero Trust de Cloudflare.
if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
  log "Instalando cloudflared y registrando el túnel de Cloudflare"
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y
  apt-get install -y cloudflared
  # El token se guarda en un fichero solo legible por root y se pasa por
  # variable de entorno: nunca aparece en la línea de comandos ni en la unidad
  # systemd (visibles para otros usuarios del sistema).
  install -d -m 750 /etc/agronutri
  umask 077
  cat > /etc/agronutri/cloudflared.env <<ENV
TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
ENV
  umask 022
  chmod 600 /etc/agronutri/cloudflared.env
  # Se elimina el servicio que pudiera haber instalado `cloudflared service install`
  # (guardaría el token en la unidad) y se usa una unidad propia.
  cloudflared service uninstall >/dev/null 2>&1 || true
  cat > /etc/systemd/system/cloudflared.service <<UNIT
[Unit]
Description=Cloudflare Tunnel (AgroNutri AI)
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
EnvironmentFile=/etc/agronutri/cloudflared.env
ExecStart=$(command -v cloudflared) --no-autoupdate tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now cloudflared
  systemctl restart cloudflared
  sleep 2
  if systemctl is-active --quiet cloudflared; then
    echo "Túnel de Cloudflare activo."
  else
    echo "AVISO: el servicio cloudflared no está activo. Revisa: journalctl -u cloudflared -n 30" >&2
  fi
fi

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

 Entra con la cuenta de administrador que acabas de definir:
   ${ADMIN_EMAIL_LC}

 La clave de OpenAI se configura después dentro de la app (Ajustes).
 Si configuraste Resend, la recuperación de contraseña por email ya funciona.
FIN

if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
cat <<FIN

 Túnel de Cloudflare: ACTIVO.
   - En el panel Zero Trust de Cloudflare (Networks > Tunnels), en el túnel que
     creaste, añade un "Public hostname":
        Hostname: ${TUNNEL_HOSTNAME:-<tu dominio>}
        Service:  http://localhost:80
   - La app quedará accesible en: ${APP_URL}
   - Estado del túnel:  systemctl status cloudflared
   - Logs del túnel:    journalctl -u cloudflared -f
FIN
fi

echo "============================================================"
