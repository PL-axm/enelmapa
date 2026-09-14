#!/bin/bash
#
# Respaldo nocturno de enelmapa: base de datos e imágenes de los negocios.
#
# Hasta esto no había NINGÚN respaldo de la base. Las fotos se salvaron el
# 2026-09-09 sólo porque alguien renombró una carpeta en vez de borrarla; la
# base no habría tenido esa suerte.
#
# Cron (una vez por noche), ejecutando esta copia del repo:
#   0 3 * * * /bin/bash /home/<user>/public_html/enelmapa.co/deploy/respaldo.sh
#
# Credenciales: se leen de ~/.my.cnf (permisos 600), NUNCA de la línea de
# comandos, donde quedarían a la vista en la lista de procesos:
#   [mysqldump]
#   user=...
#   password=...
#
# Lo que este script tiene prohibido, por lo que ya pasó:
#   * escribir dentro del directorio de la app o de public_html. Los respaldos
#     van en el home: fuera del alcance de la web y de `git reset`.
#   * tocar uploads/ de la app: sólo la LEE.
#   * borrar respaldos viejos si el de hoy falló.
#   * llenar el disco. Si la cuenta se queda sin cuota, MySQL y las subidas de
#     fotos empiezan a fallar, y eso sí rompería el sitio. Pasado el tope, no
#     respalda y lo deja escrito.
#
# Las rutas se pueden sobrescribir con variables RESPALDO_* sólo para probar el
# script fuera del servidor.

set -uo pipefail

APP="${RESPALDO_APP:-/home/moralesbilma/public_html/enelmapa.co}"
DESTINO="${RESPALDO_DESTINO:-/home/moralesbilma/respaldos-enelmapa}"
DB="${RESPALDO_DB:-moralesbilma_enelmapa}"
MYCNF="${RESPALDO_MYCNF:-$HOME/.my.cnf}"
DIAS="${RESPALDO_DIAS:-14}"
TOPE_MB="${RESPALDO_TOPE_MB:-1500}"
LOG="$DESTINO/respaldo.log"

# --- salvaguardas antes de escribir nada ------------------------------------

# Esta va ANTES del mkdir, y avisa por stderr (que cron manda por correo) en vez
# de al log: el log vive dentro del destino, así que escribirlo ya sería crear
# carpetas dentro de la app. La primera versión tenía el mkdir arriba y, aunque
# se negaba a respaldar, ya había dejado `respaldos/` adentro del directorio
# de la app. Lo encontró la prueba de este caso.
case "$DESTINO" in
  */public_html|*/public_html/*|"$APP"|"$APP"/*)
    echo "respaldo.sh: el destino $DESTINO está dentro de public_html o de la app. No se respalda." >&2
    exit 1 ;;
esac

mkdir -p "$DESTINO/db" "$DESTINO/uploads"
chmod 700 "$DESTINO"

log() { echo "$(date -Is) $*" >> "$LOG"; }

log "=============== inicio"

if [ ! -f "$MYCNF" ]; then
  log "ERROR no existe $MYCNF con las credenciales de mysqldump. No se respalda."
  exit 1
fi

USADO_MB=$(du -sm "$DESTINO" | cut -f1)
if [ "$USADO_MB" -gt "$TOPE_MB" ]; then
  log "ERROR los respaldos ya ocupan ${USADO_MB} MB (tope ${TOPE_MB} MB). No se respalda para no llenar la cuota de la cuenta."
  exit 1
fi

# --- base de datos -----------------------------------------------------------

ARCHIVO="$DESTINO/db/enelmapa_$(date +%Y-%m-%d_%H%M%S).sql.gz"
PARCIAL="$ARCHIVO.parcial"

# A un .parcial y después se renombra: un dump cortado a la mitad nunca debe
# quedar con nombre de respaldo válido.
if ! mysqldump --defaults-extra-file="$MYCNF" --single-transaction --quick --no-tablespaces \
     --default-character-set=utf8mb4 "$DB" 2>>"$LOG" | gzip > "$PARCIAL"; then
  rm -f "$PARCIAL"
  log "ERROR mysqldump falló. Respaldos anteriores intactos."
  exit 1
fi

# mysqldump termina su salida con "-- Dump completed". Si esa línea no está,
# el dump se cortó aunque el comando no haya informado error.
if ! gzip -t "$PARCIAL" 2>>"$LOG"; then
  rm -f "$PARCIAL"
  log "ERROR el archivo comprimido está dañado. Respaldos anteriores intactos."
  exit 1
fi
ULTIMA_LINEA=$(gzip -dc "$PARCIAL" | tail -n 1)
if [[ "$ULTIMA_LINEA" != *"Dump completed"* ]]; then
  rm -f "$PARCIAL"
  log "ERROR el dump no terminó completo. Respaldos anteriores intactos."
  exit 1
fi

mv "$PARCIAL" "$ARCHIVO"
log "OK base: $(basename "$ARCHIVO") ($(du -k "$ARCHIVO" | cut -f1) KB)"

# Rotación SÓLO después de un respaldo verificado, y sólo sobre archivos de
# este script. Si el de hoy hubiera fallado, ya habríamos salido arriba.
BORRADOS=$(find "$DESTINO/db" -maxdepth 1 -name 'enelmapa_*.sql.gz' -mtime +"$DIAS" -print -delete | wc -l)
log "rotacion: $BORRADOS respaldos de base con más de $DIAS días eliminados"

# --- imágenes ----------------------------------------------------------------

# Copia ACUMULATIVA: agrega lo nuevo y nunca borra ni pisa lo existente. Si
# alguien borra fotos en la app —o las pisa, como el 2026-09-09—, la copia
# conserva las originales. Los nombres de archivo son aleatorios y no se
# reutilizan, así que "no pisar" nunca deja una versión vieja de algo vigente.
ORIGEN="$APP/uploads"
if [ -d "$ORIGEN" ]; then
  ANTES=$(find "$DESTINO/uploads" -type f | wc -l)
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --ignore-existing "$ORIGEN/" "$DESTINO/uploads/" 2>>"$LOG"
    RC=$?
  else
    # Según la versión, `cp -n` devuelve error cuando saltea archivos
    # existentes, que acá es el caso normal. Por eso se verifica por conteo y no
    # por código de salida.
    cp -a -n "$ORIGEN/." "$DESTINO/uploads/" 2>>"$LOG"
    RC=0
  fi
  EN_APP=$(find "$ORIGEN" -type f | wc -l)
  EN_COPIA=$(find "$DESTINO/uploads" -type f | wc -l)
  if [ "$RC" -ne 0 ] || [ "$EN_COPIA" -lt "$EN_APP" ]; then
    log "ERROR copia de imágenes incompleta (app: $EN_APP, copia: $EN_COPIA, codigo: $RC)"
  else
    log "OK imagenes: $EN_COPIA en la copia (+$((EN_COPIA - ANTES)) nuevas; la app tiene $EN_APP)"
  fi
else
  log "AVISO no existe $ORIGEN"
fi

log "espacio usado por los respaldos: $(du -sm "$DESTINO" | cut -f1) MB (tope ${TOPE_MB} MB)"
log "=============== fin"
