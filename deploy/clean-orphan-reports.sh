#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — limpieza de ficheros de informes huérfanos de UNA instancia
#
# Elimina del directorio de informes de la instancia los ficheros que su base
# de datos ya no referencia (columna reports.file_path). Lo usa demo-reset.sh
# tras restaurar la copia de referencia de la demo: los PDFs generados por los
# visitantes viven en el sistema de ficheros y el restore de la base de datos
# no los borra.
#
# IMPORTANTE: el directorio debe ser EXCLUSIVO de la instancia (variable
# REPORTS_DIR escrita por provision-coop.sh). Nunca se debe apuntar a un
# directorio compartido con otras cooperativas: todo fichero del directorio
# que la base de datos no referencie será eliminado.
#
# Uso:
#   clean-orphan-reports.sh <base-de-datos> <directorio-de-informes>
#
# Variables (para pruebas):
#   PSQL_CMD   Comando psql a usar (por defecto: sudo -u postgres psql)
#
# Si la consulta a la base de datos falla, NO se borra nada y se sale con
# error: nunca se trata un fallo como "no hay informes".
# ============================================================================
set -euo pipefail

DB_NAME="${1:-}"
REPORTS_DIR="${2:-}"

if [[ -z "$DB_NAME" || -z "$REPORTS_DIR" ]]; then
  echo "Uso: clean-orphan-reports.sh <base-de-datos> <directorio-de-informes>" >&2
  exit 1
fi

REPORTS_DIR="$(realpath -m -- "$REPORTS_DIR")"
if [[ ! -d "$REPORTS_DIR" ]]; then
  echo "AVISO: no existe ${REPORTS_DIR}; nada que limpiar."
  exit 0
fi

if ! REFERENCED="$(${PSQL_CMD:-sudo -u postgres psql} -tA -d "$DB_NAME" \
  -c "SELECT file_path FROM reports WHERE file_path IS NOT NULL")"; then
  echo "ERROR: no se pudo consultar los informes de ${DB_NAME}; no se borra nada." >&2
  exit 1
fi

REMOVED=0
while IFS= read -r -d '' f; do
  real="$(realpath -m -- "$f")"
  # Solo ficheros realmente dentro del directorio (por si hay enlaces raros).
  case "$real" in
    "${REPORTS_DIR}"/*) ;;
    *) continue ;;
  esac
  # Sigue referenciado por la base de datos: se conserva.
  grep -qxF -- "$real" <<< "$REFERENCED" && continue
  rm -f -- "$real"
  REMOVED=$((REMOVED + 1))
done < <(find "$REPORTS_DIR" -type f -print0)

echo "OK: ${REMOVED} fichero(s) de informes huérfanos eliminados de ${REPORTS_DIR}."
