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

Cada restauración pasa por `backup-coop.sh restore`, que detiene el servicio,
guarda antes una copia `pre-restore-<fecha>.dump` por si acaso, restaura la
base de datos y vuelve a arrancar el servicio.
