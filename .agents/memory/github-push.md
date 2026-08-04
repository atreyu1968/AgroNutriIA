---
name: Push a GitHub desde el workspace
description: Cómo publicar commits en el repo GitHub del usuario cuando git push directo falla por autenticación
---

## Regla

`git push` directo a GitHub falla ("Invalid username or token"). Usar el callback `gitPush` del skill git-remote, que requiere:

1. Un remoto llamado `origin` apuntando al repo GitHub (`git remote add origin https://github.com/...`).
2. Que la rama siga `origin/main`, no un remoto `subrepl-*`. Si `origin/main` no existe localmente, crearlo sin fetch: `git update-ref refs/remotes/origin/main <sha-remoto>` y luego `git branch -u origin/main main`.
3. Entonces `await gitPush({ branch: "main" })` en CodeExecution funciona.

**Why:** gitPush rechaza publicar si la rama sigue otro remoto ("cannot publish main") y da BRANCH_ALREADY_EXISTS sin upstream.

**How to apply:** Tras cada bloque de trabajo hay que subir a GitHub para que el servidor del usuario pueda hacer `update.sh`; los merges de tareas los sube la plataforma sola, pero los commits propios requieren este procedimiento.
