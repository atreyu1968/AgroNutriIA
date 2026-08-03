#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — aprovisionador por cooperativa (contratación online)
#
# Crea una instalación independiente para una cooperativa en un servidor que
# ya tiene la instalación base hecha con deploy/install.sh (Node, pnpm,
# PostgreSQL, nginx y el repositorio compilado en APP_DIR). Cada cooperativa
# obtiene:
#   - Subdominio propio: <sub>.<dominio base>  (requiere DNS wildcard *.<dominio>)
#   - Base de datos y usuario PostgreSQL propios
#   - Servicio systemd propio (agronutri-<sub>) en un puerto libre
#   - Sitio nginx propio con certificado TLS (Let's Encrypt, o el wildcard ya
#     instalado si existe)
#   - Cuenta de administrador inicial (ADMIN_EMAIL / ADMIN_PASSWORD)
#
# Lo invoca automáticamente el servicio de aprovisionamiento de la API cuando
# la suscripción de PayPal se activa (variable de entorno PROVISION_SCRIPT
# apuntando a este fichero en la instalación central).
#
# Uso:
#   sudo bash provision-coop.sh <subdominio> <dominio-base>
#
# Variables (exportadas por el aprovisionador):
#   COOP_NAME       Nombre de la cooperativa
#   ADMIN_EMAIL     Email del administrador inicial (obligatorio)
#   ADMIN_PASSWORD  Contraseña temporal del administrador (obligatoria)
#   ADMIN_NAME      Nombre del administrador (por defecto: Administrador)
#   CENTRAL_URL     URL pública de la central de facturación (para el reporte de uso)
#   INSTALL_TOKEN   Token secreto de la instalación (autentica el reporte de uso)
#   APP_DIR         Instalación base compartida (por defecto /opt/agronutri)
#   PORT_BASE       Primer puerto candidato (por defecto 3100)
# ============================================================================
set -euo pipefail

SUB="${1:-}"
BASE_DOMAIN="${2:-}"
APP_DIR="${APP_DIR:-/opt/agronutri}"
PORT_BASE="${PORT_BASE:-3100}"
ADMIN_NAME="${ADMIN_NAME:-Administrador}"

if [[ -z "$SUB" || -z "$BASE_DOMAIN" ]]; then
  echo "Uso: provision-coop.sh <subdominio> <dominio-base>" >&2; exit 1
fi
if [[ ! "$SUB" =~ ^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$ ]]; then
  echo "ERROR: subdominio no válido: $SUB" >&2; exit 1
fi
if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ERROR: faltan ADMIN_EMAIL / ADMIN_PASSWORD" >&2; exit 1
fi
# Los datos vienen del formulario público: se validan y sanean aquí también
# (defensa en profundidad) antes de tocar systemd, nginx o SQL.
if [[ ! "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "ERROR: ADMIN_EMAIL no tiene formato de email válido." >&2; exit 1
fi
# Nombre de cooperativa/admin: solo caracteres imprimibles seguros, sin saltos
# de línea ni comillas, y longitud acotada (solo se usa como descripción).
sanitize_label() {
  printf '%s' "$1" | tr -d '\n\r' | tr -cd 'A-Za-z0-9 .,()&_-' | cut -c1-80
}
COOP_LABEL="$(sanitize_label "${COOP_NAME:-$SUB}")"
ADMIN_NAME="$(sanitize_label "$ADMIN_NAME")"
[[ -n "$COOP_LABEL" ]] || COOP_LABEL="$SUB"
[[ -n "$ADMIN_NAME" ]] || ADMIN_NAME="Administrador"
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta este script como root (sudo)." >&2; exit 1
fi
if [[ ! -d "$APP_DIR" ]]; then
  echo "ERROR: no existe la instalación base en $APP_DIR (ejecuta antes install.sh)." >&2; exit 1
fi

DOMAIN="${SUB}.${BASE_DOMAIN}"
SERVICE_NAME="agronutri-${SUB}"
DB_NAME="agronutri_${SUB//-/_}"
DB_USER="$DB_NAME"
DB_PASS="$(openssl rand -hex 16)"
SESSION_SECRET="$(openssl rand -hex 32)"
ENV_DIR="/etc/agronutri/instances"
ENV_FILE="${ENV_DIR}/${SUB}.env"
NGINX_SITE="/etc/nginx/sites-available/agronutri-${SUB}"

echo "== [1/6] Puerto libre =="
API_PORT="$PORT_BASE"
while ss -ltn "sport = :$API_PORT" | grep -q LISTEN; do API_PORT=$((API_PORT + 1)); done
echo "Puerto asignado: $API_PORT"

echo "== [2/6] Base de datos propia =="
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 ||
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 ||
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
( cd "$APP_DIR" && DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push-force )

echo "== [3/6] Configuración y servicio systemd =="
mkdir -p "$ENV_DIR"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
APP_URL=https://${DOMAIN}
# Instancia de cooperativa: oculta Instalaciones/Facturación y deshabilita sus APIs
COOP_INSTANCE=true
EOF
# Instancia de demostración: limita el uso a una finca y un informe de cada
# tipo (exporta DEMO_MODE=1 al invocar este script).
if [[ "${DEMO_MODE:-}" == "1" || "${DEMO_MODE:-}" == "true" ]]; then
  echo "DEMO_MODE=true" >> "$ENV_FILE"
  echo "   (instancia de DEMOSTRACIÓN: 1 finca y 1 informe de cada tipo)"
fi
# Reporte automático de uso: la instancia cuenta sus fincas activas y las
# envía a diario a la central (POST /api/billing/usage) para el cargo variable.
if [[ -n "${CENTRAL_URL:-}" && -n "${INSTALL_TOKEN:-}" ]]; then
  cat >> "$ENV_FILE" <<EOF
CENTRAL_URL=${CENTRAL_URL}
INSTALL_TOKEN=${INSTALL_TOKEN}
EOF
else
  echo "AVISO: CENTRAL_URL / INSTALL_TOKEN no definidos; la instancia no reportará su uso a la central." >&2
fi
chmod 600 "$ENV_FILE"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=AgroNutri AI API (${COOP_LABEL})
After=network.target postgresql.service

[Service]
Type=simple
User=agronutri
WorkingDirectory=${APP_DIR}/artifacts/api-server
EnvironmentFile=${ENV_FILE}
ExecStart=$(command -v node) ${APP_DIR}/artifacts/api-server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "== [4/6] Cuenta de administrador inicial =="
# El hash se calcula fuera y los valores entran como variables psql
# (:'var'), que las escapa correctamente: nada de interpolar texto en SQL.
HASH="$(cd "$APP_DIR/artifacts/api-server" && node -e "console.log(require('bcryptjs').hashSync(process.env.ADMIN_PASSWORD, 10))")"
sudo -u postgres psql -d "$DB_NAME" \
  -v email="$ADMIN_EMAIL" -v hash="$HASH" -v name="$ADMIN_NAME" <<'EOF'
INSERT INTO users (email, password_hash, name, is_admin, active, role)
VALUES (:'email', :'hash', :'name', true, true, 'owner')
ON CONFLICT (email) DO NOTHING;
EOF

echo "== [5/6] nginx =="
WEB_ROOT="${APP_DIR}/artifacts/agronutri/dist"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    root ${WEB_ROOT};
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
        client_max_body_size 15m;
    }
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/agronutri-${SUB}"
nginx -t && systemctl reload nginx

echo "== [6/6] Certificado TLS y comprobación final =="
# Si hay un certificado wildcard para *.<dominio base> instalado, certbot lo
# reutiliza; si no, se emite uno propio. Un fallo aquí ABORTA el alta: la
# instalación no debe marcarse activa sin HTTPS operativo.
if ! command -v certbot >/dev/null 2>&1; then
  echo "ERROR: certbot no está instalado; no se puede emitir el certificado TLS." >&2
  exit 1
fi
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "${ADMIN_EMAIL}" --redirect

# Comprobación de salud: la API debe responder por HTTPS antes de dar el OK.
for i in $(seq 1 10); do
  if curl -fsS --max-time 10 "https://${DOMAIN}/api/healthz" >/dev/null 2>&1; then
    echo "Comprobación HTTPS correcta."
    break
  fi
  if [[ "$i" == 10 ]]; then
    echo "ERROR: https://${DOMAIN}/api/healthz no responde tras el despliegue." >&2
    exit 1
  fi
  sleep 3
done

echo
echo "=================================================================="
echo " Instalación creada: https://${DOMAIN}"
echo "   Servicio : ${SERVICE_NAME} (puerto ${API_PORT})"
echo "   BD       : ${DB_NAME}"
echo "   Admin    : ${ADMIN_EMAIL}"
echo "=================================================================="
