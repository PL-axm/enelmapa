#!/bin/bash
#
# Deploy por cron para el hosting de cPanel/Passenger.
#
# Esta copia está versionada para poder revisarla; la que CORRE vive fuera del
# docroot, en /home/<user>/deploy-enelmapa.sh, porque cualquier cosa dentro de
# public_html/enelmapa.co es alcanzable por URL — y este script ejecuta git y
# npm. El propio script se auto-actualiza al final (ver "auto-actualización"),
# así que después de instalarlo una vez no hay que volver a copiarlo a mano.
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
# Instalación (una sola vez):
#   cp deploy/deploy.sh /home/<user>/deploy-enelmapa.sh && chmod 755 …
#   cron cada 5 minutos:  */5 * * * * /home/<user>/deploy-enelmapa.sh
#
set -eo pipefail

APP=/home/moralesbilma/public_html/enelmapa.co
VENV=/home/moralesbilma/nodevenv/public_html/enelmapa.co/22/bin
BAK=/home/moralesbilma/.htaccess.produccion
SELF=/home/moralesbilma/deploy-enelmapa.sh
LOG=/home/moralesbilma/deploy.log
URL=https://enelmapa.co/

cd "$APP"

git fetch origin main --quiet

ANTES=$(git rev-parse HEAD)
REMOTO=$(git rev-parse origin/main)

# Sin novedades: sale en milisegundos. Es el caso normal, 287 de cada 288
# ejecuciones del día.
if [ "$ANTES" = "$REMOTO" ]; then
  exit 0
fi

{
  echo "========================================"
  echo "$(date -Is) desplegando ${ANTES:0:7} -> ${REMOTO:0:7}"
} >> "$LOG"

# El .htaccess de producción NO está en el repo: lleva el bloque de Passenger,
# y sin él Passenger no sabe qué app levantar. Estando ignorado, `git reset
# --hard` ya no lo toca; el respaldo cubre cualquier commit futuro que lo
# reintroduzca por error.
if [ -f .htaccess ]; then
  cp -p .htaccess "$BAK"
fi

git reset --hard origin/main >> "$LOG" 2>&1

if [ ! -f .htaccess ] && [ -f "$BAK" ]; then
  cp -p "$BAK" .htaccess
  echo "$(date -Is) .htaccess restaurado desde el respaldo" >> "$LOG"
fi

# npm install SÓLO si cambiaron las dependencias. La enorme mayoría de los
# deploys no las tocan, y correrlo siempre agregaba medio minuto a cada uno.
if ! git diff --quiet "$ANTES" "$REMOTO" -- package.json package-lock.json; then
  echo "$(date -Is) cambiaron las dependencias, instalando" >> "$LOG"
  export PATH="$VENV:$PATH"
  if ! npm install --omit=dev >> "$LOG" 2>&1; then
    {
      echo "$(date -Is) !!! npm install FALLÓ — DEPLOY INCOMPLETO"
      echo "$(date -Is) !!! Node NO se reinició: sigue corriendo el código viejo."
      echo "$(date -Is) !!! Los archivos en disco YA son los nuevos."
    } >> "$LOG"
    exit 1
  fi
fi

# === REINICIO ===
#
# `touch tmp/restart.txt`, que es el mecanismo estándar de Passenger, NO
# funciona en este hosting. Se comprobó: el archivo se tocaba cada 5 minutos y
# el proceso mantuvo el mismo PID durante 40 minutos seguidos, sirviendo las
# vistas EJS viejas desde la caché de Express — el código en disco dejaba de
# ser el que corría, y eso ya costó una hora de confusión.
#
# Las dos vías limpias están cerradas: `cloudlinux-selector` no existe dentro
# de la jailshell de la cuenta, y `uapi PassengerApps list_applications`
# devuelve vacío porque la app la maneja el Node.js Selector de CloudLinux, no
# el Application Manager de cPanel.
#
# Así que se mata el proceso y Passenger lo relanza, que es su comportamiento
# normal. Passenger le renombra el proceso a "Passenger NodeApp: <app root>",
# de ahí el patrón — un `pkill` contra la ruta del binario de node no encuentra
# nada. Corriendo desde un archivo, la línea de comandos de este script es sólo
# su propia ruta, así que el patrón no se encuentra a sí mismo.
#
# `|| true` porque pkill devuelve 1 si no había nada que matar, y eso no es un
# error: significa que la app estaba dormida.
echo "$(date -Is) reiniciando Node" >> "$LOG"
pkill -f "Passenger NodeApp: $APP" || true

# Passenger levanta la app recién en la siguiente petición. Se hace acá para
# que el arranque en frío —que incluye correr las migraciones— lo pague el
# deploy y no el primer cliente que entre. Si falla no importa: el próximo
# visitante la levanta igual.
sleep 2
curl -s -o /dev/null --max-time 60 "$URL" || true

# === auto-actualización ===
#
# El script que corre es una copia, así que mejorarlo en el repo no cambiaba lo
# que se ejecuta. Se copia a un temporal y se renombra: `mv` es atómico y deja
# intacto el inodo que bash tiene abierto, así que la ejecución en curso no se
# corrompe. Sobrescribir el archivo en el lugar sí la corrompería, porque bash
# lee el script de a pedazos mientras avanza.
if [ -f deploy/deploy.sh ]; then
  cp deploy/deploy.sh "$SELF.nuevo"
  mv "$SELF.nuevo" "$SELF"
  chmod 755 "$SELF"
fi

echo "$(date -Is) OK — ahora en $(git rev-parse --short HEAD)" >> "$LOG"
