#!/usr/bin/env bash
# ============================================================================
# AgroNutri AI — limpieza de PDFs de analíticas huérfanos de UNA instancia
#
# Elimina del directorio de analíticas de la instancia los ficheros que su
# base de datos ya no referencia (columna analyses.source_pdf, que guarda el
# NOMBRE de fichero, no la ruta). Lo usa demo-reset.sh tras restaurar la copia
# de referencia de la demo: los PDFs subidos por los visitantes viven en el
# sistema de ficheros y el restore de la base de datos no los borra.
#
# IMPORTANTE: el directorio debe ser EXCLUSIVO de la instancia (variable
# ANALYSES_DIR escrita por provision-coop.sh). Nunca se debe apuntar a un
# directorio compartido con otras cooperativas: todo fichero del directorio
# que la base de datos no referencie será eliminado.
#
# Uso:
#   clean-orphan-analyses.sh <base-de-datos> <directorio-de-analiticas>
#
# Variables (para pruebas):
#   PSQL_CMD   Comando psql a usar (por defecto: sudo -u postgres psql)
#
# Si la consulta a la base de datos falla, NO se borra nada y se sale con
# error: nunca se trata un fallo como "no hay analíticas".
# ============================================================================
set -euo pipefail

DB_NAME="${1:-}"
ANALYSES_DIR="${2:-}"

if [[ -z "$DB_NAME" || -z "$ANALYSES_DIR" ]]; then
  echo "Uso: clean-orphan-analyses.sh <base-de-datos> <directorio-de-analiticas>" >&2
  exit 1
fi

ANALYSES_DIR="$(realpath -m -- "$ANALYSES_DIR")"
if [[ ! -d "$ANALYSES_DIR" ]]; then
  echo "AVISO: no existe ${ANALYSES_DIR}; nada que limpiar."
  exit 0
fi

if ! REFERENCED="$(${PSQL_CMD:-sudo -u postgres psql} -tA -d "$DB_NAME" \
  -c "SELECT source_pdf FROM analyses WHERE source_pdf IS NOT NULL")"; then
  echo "ERROR: no se pudo consultar las analíticas de ${DB_NAME}; no se borra nada." >&2
  exit 1
fi

REMOVED=0
while IFS= read -r -d '' f; do
  real="$(realpath -m -- "$f")"
  # Solo ficheros realmente dentro del directorio (por si hay enlaces raros).
  case "$real" in
    "${ANALYSES_DIR}"/*) ;;
    *) continue ;;
  esac
  # Sigue referenciado por la base de datos (por nombre): se conserva.
  grep -qxF -- "$(basename -- "$real")" <<< "$REFERENCED" && continue
  rm -f -- "$real"
  REMOVED=$((REMOVED + 1))
done < <(find "$ANALYSES_DIR" -type f -print0)

echo "OK: ${REMOVED} PDF(s) de analíticas huérfanos eliminados de ${ANALYSES_DIR}."
