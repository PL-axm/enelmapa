#!/bin/bash
#
# Deploy por cron para el hosting de cPanel/Passenger.
#
# Esta copia está versionada para poder revisarla; la que CORRE vive fuera del
# docroot, en /home/<user>/deploy-enelmapa.sh, porque cualquier cosa dentro de
# public_html/enelmapa.co es alcanzable por URL — y este script ejecuta git y
# npm. Al copiarla al servidor hay que darle permisos 0755.
#
# Se eligió cron y no un webhook de GitHub por dos razones:
#
#   1. Con `PassengerBaseURI "/"` TODAS las peticiones a enelmapa.co las
#      atiende Node, así que un endpoint PHP dentro del app root no se ejecuta
#      de forma confiable — hay que sacar el .htaccess del medio para que corra,
#      que es justamente lo que no se puede hacer en un deploy desatendido.
#   2. Un endpoint público que ejecuta shell es un blanco. En los logs de este
#      servidor hay bots probando /.env, /admin/.env, /backup/.env … a más de
#      100 peticiones por minuto.
#
# Instalación:
#   cp deploy/deploy.sh /home/<user>/deploy-enelmapa.sh && chmod 755 …
#   cron cada 5 minutos:  */5 * * * * /home/<user>/deploy-enelmapa.sh
#
set -eo pipefail

APP=/home/moralesbilma/public_html/enelmapa.co
VENV=/home/moralesbilma/nodevenv/public_html/enelmapa.co/22/bin
BAK=/home/moralesbilma/.htaccess.produccion
LOG=/home/moralesbilma/deploy.log

cd "$APP"

git fetch origin main --quiet

# Sin novedades: sale en milisegundos. Es el caso normal, 287 de cada 288
# ejecuciones del día.
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi

{
  echo "========================================"
  echo "$(date -Is) desplegando $(git rev-parse --short HEAD) -> $(git rev-parse --short origin/main)"
} >> "$LOG"

# El .htaccess de producción NO está en el repo: lleva el bloque de Passenger y
# las variables de entorno, y como acá no se usa dotenv es la única fuente de
# process.env en el servidor. Estando ignorado, `git reset --hard` ya no lo
# toca; el respaldo cubre el primer deploy —donde todavía viene trackeado y sí
# se borra— y cualquier commit futuro que lo reintroduzca por error.
if [ -f .htaccess ]; then
  cp -p .htaccess "$BAK"
fi

git reset --hard origin/main >> "$LOG" 2>&1

if [ ! -f .htaccess ] && [ -f "$BAK" ]; then
  cp -p "$BAK" .htaccess
  echo "$(date -Is) .htaccess restaurado desde el respaldo" >> "$LOG"
fi

export PATH="$VENV:$PATH"
npm install --omit=dev >> "$LOG" 2>&1

# Las migraciones NO se corren acá: server.js las aplica al arrancar. Passenger
# recicla el proceso cuando cambia la fecha de tmp/restart.txt.
mkdir -p tmp
touch tmp/restart.txt

echo "$(date -Is) OK — ahora en $(git rev-parse --short HEAD)" >> "$LOG"
