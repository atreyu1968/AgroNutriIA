# Despliegue de AgroNutri AI

Scripts de instalación y operación del servidor:

| Script | Qué hace |
| --- | --- |
| `install.sh` | Instalación base (central): Node, pnpm, PostgreSQL, nginx, compilación y servicio systemd. |
| `provision-coop.sh` | Crea una instalación independiente por cooperativa (`<sub>.<dominio>`): BD, servicio, nginx y TLS. Lo invoca la central al activarse una suscripción (`PROVISION_SCRIPT`). |
| `backup-coop.sh` | Copia de seguridad (`dump`) y restauración (`restore`) de la base de datos de una cooperativa. Lo invoca la central (`BACKUP_SCRIPT`). |
| `demo-reset.sh` | Reinicio nocturno automático de la cooperativa de demostración. |

## Reinicio nocturno de la demo

La instancia de pruebas ("Prueba Coop", aprovisionada con `DEMO_MODE=1`) es
compartida por todos los visitantes y limita el uso a **1 finca y 1 informe de
cada tipo**. Sin un reinicio periódico, el primer visitante agota los límites y
los siguientes encuentran la demo "usada".

`demo-reset.sh` restaura cada noche (04:00, con `Persistent=true` por si el
servidor estaba apagado) una copia de referencia "limpia" de la demo,
reutilizando `backup-coop.sh`.

### Activación (una sola vez)

1. Aprovisiona la demo y déjala en el estado que quieres que vean los
   visitantes (cuenta de administrador, datos de ejemplo si los quieres, etc.):

   ```bash
   sudo DEMO_MODE=1 COOP_NAME="Prueba Coop" \
        ADMIN_EMAIL=demo@tudominio.es ADMIN_PASSWORD='...' \
        bash provision-coop.sh prueba tudominio.es
   ```

2. Guarda la copia de referencia y activa el temporizador:

   ```bash
   sudo bash demo-reset.sh setup prueba
   ```

   Esto crea `/var/backups/agronutri/prueba/demo-reference.dump` a partir del
   estado **actual** de la instancia e instala el temporizador systemd
   `agronutri-demo-reset-prueba.timer`.

Solo funciona sobre instancias con `DEMO_MODE=true` en su fichero de entorno
(`/etc/agronutri/instances/<sub>.env`): el script se niega a programar o
ejecutar el reinicio sobre una cooperativa real.

### Operación

```bash
# Ver el próximo reinicio programado
systemctl list-timers agronutri-demo-reset-prueba.timer

# Reiniciar la demo ahora mismo
sudo bash demo-reset.sh restore prueba

# Regenerar la copia de referencia (tras cambiar el contenido de la demo)
sudo bash demo-reset.sh setup prueba

# Desactivar el reinicio nocturno
sudo bash demo-reset.sh disable prueba

# Logs de los reinicios
journalctl -u agronutri-demo-reset-prueba.service
```

### Aviso si el reinicio nocturno falla

Si una noche el reinicio falla (disco lleno, copia de referencia corrupta,
PostgreSQL caído…), la demo queda "usada" o parada. Para no enterarse por un
visitante, `setup` instala también una unidad `OnFailure=`
(`agronutri-demo-reset-<sub>-failure.service`) que se dispara cuando el
servicio de reinicio termina en error y hace tres cosas:

1. **Deja constancia en el journal** de la unidad de aviso:
   `journalctl -u agronutri-demo-reset-prueba-failure.service`.
2. **Escribe un fichero-marcador** con fecha y máquina en
   `/var/backups/agronutri/<sub>/last-reset-failed`. El siguiente reinicio que
   termine bien lo elimina, así que su existencia indica que el último intento
   falló.
3. **Envía un email** vía Resend si la central lo tiene configurado: requiere
   `RESEND_API_KEY` y `ALERT_EMAIL` (destinatario de avisos operativos) en
   `/etc/agronutri/api.env`. `install.sh` acepta `ALERT_EMAIL` como variable de
   entorno y conserva el valor existente al reinstalar; también puede añadirse
   a mano al fichero. Sin estas variables, el aviso queda solo en el journal y
   en el marcador.

Para probar el aviso sin romper nada:

```bash
sudo bash demo-reset.sh notify-failure prueba
```

Cada restauración pasa por `backup-coop.sh restore`, que detiene el servicio,
guarda antes una copia `pre-restore-<fecha>.dump` por si acaso, restaura la
base de datos y vuelve a arrancar el servicio.

### Limpieza de PDFs de informes huérfanos

Los PDFs de informes generados por los visitantes viven en el sistema de
ficheros (`<APP_DIR>/artifacts/api-server/storage/reports`), no en la base de
datos, así que la restauración nocturna por sí sola los dejaría huérfanos y se
acumularían noche tras noche.

Por eso, tras restaurar la copia de referencia, `demo-reset.sh restore` invoca
`clean-orphan-reports.sh`, que elimina del directorio de informes de la demo
los ficheros que la base de datos restaurada ya no referencia. Si la consulta
a la base de datos falla, no se borra nada y el servicio sale con error.

La limpieza solo actúa sobre el directorio de informes **exclusivo** de la
instancia demo: `provision-coop.sh` escribe en el fichero de entorno de cada
instancia `REPORTS_DIR=<APP_DIR>/artifacts/api-server/storage/reports/<sub>`,
porque todas las instancias comparten `APP_DIR` y en un directorio común los
nombres `informe-<farmId>-<reportId>` (ids serial por base de datos) podrían
colisionar entre cooperativas. Si el fichero de entorno de la demo no define
`REPORTS_DIR` (instancias aprovisionadas antes de este cambio) o este apunta
al directorio compartido, la limpieza **se omite con un aviso** en vez de
arriesgarse a tocar informes de cooperativas reales; añade la variable al
fichero de entorno, mueve los ficheros de la demo a su subdirectorio y
reinicia el servicio para activarla.

El script asume la instalación base en `/opt/agronutri`; si usaste otra ruta,
exporta `APP_DIR` al ejecutarlo (igual que con `provision-coop.sh`).

Las pruebas de la limpieza (huérfanos, colisión de nombres con otra instancia
y fallo de la consulta) están en `deploy/test/clean-orphan-reports.test.sh`.
