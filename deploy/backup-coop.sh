#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — copias de seguridad por cooperativa
#
# Crea o restaura una copia de seguridad de la base de datos de una
# instalación de cooperativa aprovisionada con provision-coop.sh en este
# mismo servidor. El formato es el "custom" de pg_dump (.dump), comprimido
# y restaurable con pg_restore.
#
# Lo invoca la instalación central (variable BACKUP_SCRIPT apuntando a este
# fichero), igual que PROVISION_SCRIPT.
#
# Uso:
#   sudo bash backup-coop.sh <subdominio> dump <fichero-destino.dump>
#   sudo bash backup-coop.sh <subdominio> restore <fichero-origen.dump>
#
# En "restore" se detiene el servicio de la cooperativa, se restaura la base
# de datos (limpiando los objetos existentes) y se vuelve a arrancar.
# ============================================================================
set -euo pipefail

SUB="${1:-}"
ACTION="${2:-}"
FILE="${3:-}"

if [[ -z "$SUB" || -z "$ACTION" || -z "$FILE" ]]; then
  echo "Uso: backup-coop.sh <subdominio> dump|restore <fichero>" >&2; exit 1
fi
if [[ ! "$SUB" =~ ^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$ ]]; then
  echo "ERROR: subdominio no válido: $SUB" >&2; exit 1
fi

DB_NAME="agronutri_${SUB//-/_}"
SERVICE="agronutri-${SUB}"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "ERROR: la base de datos ${DB_NAME} no existe en este servidor." >&2; exit 1
fi

case "$ACTION" in
  dump)
    TMP="$(mktemp /tmp/agronutri-backup.XXXXXX.dump)"
    trap 'rm -f "$TMP"' EXIT
    sudo -u postgres pg_dump -Fc -f "$TMP" "$DB_NAME"
    install -m 0640 "$TMP" "$FILE"
    echo "OK: copia creada en $FILE ($(du -h "$FILE" | cut -f1))"
    ;;
  restore)
    if [[ ! -s "$FILE" ]]; then
      echo "ERROR: el fichero $FILE no existe o está vacío." >&2; exit 1
    fi
    # Validación previa: debe ser un archivo de pg_dump en formato custom.
    if ! sudo -u postgres pg_restore --list "$FILE" >/dev/null 2>&1; then
      echo "ERROR: el fichero no es una copia válida de pg_dump (formato custom)." >&2; exit 1
    fi
    # Copia de seguridad automática previa a la restauración, por si acaso.
    SAFE="/var/backups/agronutri/${SUB}/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
    mkdir -p "$(dirname "$SAFE")"
    sudo -u postgres pg_dump -Fc -f /tmp/agronutri-prerestore.dump "$DB_NAME"
    install -m 0640 /tmp/agronutri-prerestore.dump "$SAFE"; rm -f /tmp/agronutri-prerestore.dump
    TMPR="$(mktemp /tmp/agronutri-restore.XXXXXX.dump)"
    WAS_ACTIVE=0
    systemctl is-active --quiet "$SERVICE" && WAS_ACTIVE=1
    # Pase lo que pase (incluido un fallo de pg_restore), se limpia el temporal
    # y se rearranca el servicio si estaba en marcha, para no dejar la
    # instalación caída.
    cleanup_restore() {
      rm -f "$TMPR"
      if [[ "$WAS_ACTIVE" == "1" ]]; then
        systemctl start "$SERVICE" 2>/dev/null || true
      fi
    }
    trap cleanup_restore EXIT
    systemctl stop "$SERVICE" 2>/dev/null || true
    install -m 0644 "$FILE" "$TMPR"
    sudo -u postgres pg_restore --clean --if-exists --no-owner --no-privileges \
      --role="$DB_NAME" -d "$DB_NAME" "$TMPR"
    echo "OK: base de datos ${DB_NAME} restaurada (copia previa en $SAFE)"
    ;;
  *)
    echo "ERROR: acción desconocida: $ACTION (usa dump o restore)" >&2; exit 1
    ;;
esac
