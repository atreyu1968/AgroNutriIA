#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — reinicio nocturno de la cooperativa de demostración
#
# La instancia demo (aprovisionada con DEMO_MODE=1, p. ej. "prueba") es
# compartida por todos los visitantes y sus límites (1 finca, 1 informe de
# cada tipo) se agotan con el primer uso. Este script mantiene la demo
# siempre lista restaurando cada noche una copia "limpia" de referencia.
#
# Reutiliza deploy/backup-coop.sh (acciones dump/restore) y guarda la copia
# de referencia en /var/backups/agronutri/<sub>/demo-reference.dump.
#
# Uso (como root):
#   sudo bash demo-reset.sh setup <subdominio>
#       Guarda la copia de referencia a partir del estado ACTUAL de la
#       instancia (ejecútalo justo después de aprovisionar y dejar la demo
#       configurada a tu gusto) e instala un temporizador systemd que
#       restaura esa copia cada noche a las 04:00.
#
#   sudo bash demo-reset.sh restore <subdominio>
#       Restaura la copia de referencia ahora mismo. Es lo que ejecuta el
#       temporizador; también sirve para un reinicio manual.
#
#   sudo bash demo-reset.sh disable <subdominio>
#       Desactiva y elimina el temporizador (la copia de referencia se
#       conserva).
#
# Para regenerar la copia de referencia (p. ej. tras cambiar el contenido de
# la demo), vuelve a ejecutar "setup": sobrescribe el fichero de referencia.
# ============================================================================
set -euo pipefail

ACTION="${1:-}"
SUB="${2:-}"

if [[ -z "$ACTION" || -z "$SUB" ]]; then
  echo "Uso: demo-reset.sh setup|restore|disable <subdominio>" >&2; exit 1
fi
if [[ ! "$SUB" =~ ^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$ ]]; then
  echo "ERROR: subdominio no válido: $SUB" >&2; exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta este script como root (sudo)." >&2; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup-coop.sh"
REF_DIR="/var/backups/agronutri/${SUB}"
REF_FILE="${REF_DIR}/demo-reference.dump"
UNIT="agronutri-demo-reset-${SUB}"
ENV_FILE="/etc/agronutri/instances/${SUB}.env"

if [[ ! -f "$BACKUP_SCRIPT" ]]; then
  echo "ERROR: no se encuentra ${BACKUP_SCRIPT}." >&2; exit 1
fi

case "$ACTION" in
  setup)
    # Comprobación de seguridad: solo instancias de demostración. Restaurar
    # cada noche una cooperativa REAL destruiría los datos de sus usuarios.
    if [[ ! -f "$ENV_FILE" ]] || ! grep -q '^DEMO_MODE=true$' "$ENV_FILE"; then
      echo "ERROR: ${SUB} no es una instancia de demostración (falta DEMO_MODE=true en ${ENV_FILE})." >&2
      echo "       El reinicio nocturno solo debe activarse en la demo." >&2
      exit 1
    fi
    mkdir -p "$REF_DIR"
    echo "== Copia de referencia a partir del estado actual =="
    bash "$BACKUP_SCRIPT" "$SUB" dump "$REF_FILE"

    echo "== Servicio y temporizador systemd (${UNIT}) =="
    cat > "/etc/systemd/system/${UNIT}.service" <<EOF
[Unit]
Description=AgroNutri AI: reinicio de la demo ${SUB} desde la copia de referencia
After=postgresql.service

[Service]
Type=oneshot
ExecStart=$(command -v bash) ${SCRIPT_DIR}/demo-reset.sh restore ${SUB}
EOF
    cat > "/etc/systemd/system/${UNIT}.timer" <<EOF
[Unit]
Description=AgroNutri AI: reinicio nocturno de la demo ${SUB} (04:00)

[Timer]
OnCalendar=*-*-* 04:00:00
# Si el servidor estaba apagado a las 04:00, ejecutar al arrancar.
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now "${UNIT}.timer"
    echo
    echo "OK: reinicio nocturno activado para ${SUB}."
    echo "    Referencia : ${REF_FILE}"
    echo "    Temporizador: systemctl list-timers ${UNIT}.timer"
    echo "    Reinicio manual: sudo bash ${SCRIPT_DIR}/demo-reset.sh restore ${SUB}"
    ;;
  restore)
    if [[ ! -s "$REF_FILE" ]]; then
      echo "ERROR: no existe la copia de referencia ${REF_FILE}. Ejecuta antes: demo-reset.sh setup ${SUB}" >&2
      exit 1
    fi
    # La misma comprobación que en setup: nunca restaurar una instancia real.
    if [[ ! -f "$ENV_FILE" ]] || ! grep -q '^DEMO_MODE=true$' "$ENV_FILE"; then
      echo "ERROR: ${SUB} ya no es una instancia de demostración; reinicio abortado." >&2
      exit 1
    fi
    echo "[$(date -Is)] Restaurando demo ${SUB} desde ${REF_FILE}…"
    bash "$BACKUP_SCRIPT" "$SUB" restore "$REF_FILE"
    echo "[$(date -Is)] Demo ${SUB} restaurada."
    ;;
  disable)
    systemctl disable --now "${UNIT}.timer" 2>/dev/null || true
    rm -f "/etc/systemd/system/${UNIT}.timer" "/etc/systemd/system/${UNIT}.service"
    systemctl daemon-reload
    echo "OK: temporizador ${UNIT} desactivado (la copia ${REF_FILE} se conserva)."
    ;;
  *)
    echo "ERROR: acción desconocida: $ACTION (usa setup, restore o disable)" >&2; exit 1
    ;;
esac
