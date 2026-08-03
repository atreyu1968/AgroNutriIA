#!/usr/bin/env bash
# ============================================================================
# Pruebas de deploy/clean-orphan-reports.sh (sin PostgreSQL: psql se sustituye
# por un stub mediante PSQL_CMD).
#
#   bash deploy/test/clean-orphan-reports.test.sh
# ============================================================================
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/clean-orphan-reports.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

check() { # check <descripción> <condición...>
  local desc="$1"; shift
  if "$@"; then echo "ok: $desc"; else echo "FALLO: $desc" >&2; FAILS=$((FAILS + 1)); fi
}

# Escenario: directorio de informes propio de la demo, con un fichero
# referenciado, dos huérfanos y —fuera del directorio— el directorio
# compartido de otra cooperativa cuyo fichero COLISIONA en nombre.
DEMO_DIR="$TMP/storage/reports/prueba"
SHARED_DIR="$TMP/storage/reports"
mkdir -p "$DEMO_DIR"
touch "$DEMO_DIR/informe-1-1.pdf" "$DEMO_DIR/informe-1-2.pdf" "$DEMO_DIR/informe-2-3.docx"
# Mismo nombre de fichero que un huérfano de la demo, pero de OTRA instancia:
touch "$SHARED_DIR/informe-1-2.pdf"

# Stub de psql: la BD restaurada solo referencia informe-1-1.pdf.
cat > "$TMP/psql-ok" <<EOF
#!/usr/bin/env bash
echo "$DEMO_DIR/informe-1-1.pdf"
EOF
# Stub de psql que falla (BD inaccesible tras el restore).
cat > "$TMP/psql-fail" <<'EOF'
#!/usr/bin/env bash
echo "psql: error de conexión" >&2
exit 2
EOF
chmod +x "$TMP/psql-ok" "$TMP/psql-fail"

echo "== 1. Borra solo los huérfanos del directorio propio =="
PSQL_CMD="$TMP/psql-ok" bash "$SCRIPT" demo_db "$DEMO_DIR"
check "conserva el fichero referenciado"            test -f "$DEMO_DIR/informe-1-1.pdf"
check "elimina el huérfano pdf"                     test ! -e "$DEMO_DIR/informe-1-2.pdf"
check "elimina el huérfano docx"                    test ! -e "$DEMO_DIR/informe-2-3.docx"
check "no toca el fichero homónimo de otra instancia" test -f "$SHARED_DIR/informe-1-2.pdf"

echo "== 2. Si la consulta a la BD falla, no borra nada y sale con error =="
touch "$DEMO_DIR/informe-9-9.pdf"
RC=0
PSQL_CMD="$TMP/psql-fail" bash "$SCRIPT" demo_db "$DEMO_DIR" || RC=$?
check "sale con código distinto de 0"               test "$RC" -ne 0
check "no borra el fichero pese al fallo"           test -f "$DEMO_DIR/informe-9-9.pdf"
check "no borra el referenciado pese al fallo"      test -f "$DEMO_DIR/informe-1-1.pdf"

echo "== 3. Directorio inexistente: aviso y salida limpia =="
RC=0
PSQL_CMD="$TMP/psql-ok" bash "$SCRIPT" demo_db "$TMP/no-existe" || RC=$?
check "sale con 0 si el directorio no existe"       test "$RC" -eq 0

if [[ "$FAILS" -gt 0 ]]; then
  echo; echo "RESULTADO: ${FAILS} prueba(s) fallida(s)." >&2; exit 1
fi
echo; echo "RESULTADO: todas las pruebas pasaron."
