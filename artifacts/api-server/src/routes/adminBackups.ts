import { Router, type IRouter } from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { eq } from "drizzle-orm";
import { db, installationsTable } from "@workspace/db";
import { AdminListBackupsResponse, AdminCreateBackupResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";
import {
  listBackups,
  createBackup,
  saveUploadedBackupStream,
  restoreBackup,
  backupsSimulated,
  backupDir,
  isValidBackupFileName,
} from "../lib/backups";

const router: IRouter = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo para administradores" });
    return;
  }
  next();
});

async function loadInstallation(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id)) return null;
  const [inst] = await db.select().from(installationsTable).where(eq(installationsTable.id, id));
  return inst ?? null;
}

router.get("/admin/installations/:id/backups", async (req, res): Promise<void> => {
  const inst = await loadInstallation(req.params.id);
  if (!inst) {
    res.status(404).json({ error: "Instalación no encontrada" });
    return;
  }
  res.json(
    AdminListBackupsResponse.parse({
      simulated: backupsSimulated(),
      backups: await listBackups(inst.subdomain),
    }),
  );
});

router.post("/admin/installations/:id/backups", async (req, res): Promise<void> => {
  const inst = await loadInstallation(req.params.id);
  if (!inst) {
    res.status(404).json({ error: "Instalación no encontrada" });
    return;
  }
  try {
    const backup = await createBackup(inst);
    await audit({
      userId: req.user!.id,
      action: "admin_backup_created",
      entityType: "installation",
      entityId: inst.id,
      detail: backup.fileName,
    });
    res.json(AdminCreateBackupResponse.parse(backup));
  } catch (err) {
    res.status(502).json({
      error: `No se pudo crear la copia: ${err instanceof Error ? err.message : "error desconocido"}`,
    });
  }
});

/** Descarga de una copia (binaria, fuera del contrato OpenAPI). */
router.get(
  "/admin/installations/:id/backups/:fileName/download",
  async (req, res): Promise<void> => {
    const inst = await loadInstallation(req.params.id);
    const fileName = String(req.params.fileName);
    if (!inst) {
      res.status(404).json({ error: "Instalación no encontrada" });
      return;
    }
    if (!isValidBackupFileName(fileName)) {
      res.status(400).json({ error: "Nombre de copia no válido" });
      return;
    }
    const filePath = path.join(backupDir(inst.subdomain), fileName);
    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ error: "Copia no encontrada" });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
  },
);

/** Subida de una copia (cuerpo binario en streaming, fuera del contrato OpenAPI). */
router.post(
  "/admin/installations/:id/backups/upload",
  async (req, res): Promise<void> => {
    const inst = await loadInstallation(req.params.id);
    if (!inst) {
      res.status(404).json({ error: "Instalación no encontrada" });
      return;
    }
    if (!req.is("application/octet-stream")) {
      res.status(400).json({
        error: "Envía el fichero .dump como cuerpo binario (application/octet-stream)",
      });
      return;
    }
    let backup;
    try {
      backup = await saveUploadedBackupStream(inst, req);
    } catch (err) {
      res.status(400).json({
        error: `No se pudo guardar la copia: ${err instanceof Error ? err.message : "error desconocido"}`,
      });
      return;
    }
    await audit({
      userId: req.user!.id,
      action: "admin_backup_uploaded",
      entityType: "installation",
      entityId: inst.id,
      detail: backup.fileName,
    });
    res.json(AdminCreateBackupResponse.parse(backup));
  },
);

router.post(
  "/admin/installations/:id/backups/:fileName/restore",
  async (req, res): Promise<void> => {
    const inst = await loadInstallation(req.params.id);
    const fileName = String(req.params.fileName);
    if (!inst) {
      res.status(404).json({ error: "Instalación no encontrada" });
      return;
    }
    if (!isValidBackupFileName(fileName)) {
      res.status(400).json({ error: "Nombre de copia no válido" });
      return;
    }
    try {
      const detail = await restoreBackup(inst, fileName);
      await audit({
        userId: req.user!.id,
        action: "admin_backup_restored",
        entityType: "installation",
        entityId: inst.id,
        detail: fileName,
      });
      res.json({ ok: true, detail });
    } catch (err) {
      res.status(502).json({
        error: `No se pudo restaurar: ${err instanceof Error ? err.message : "error desconocido"}`,
      });
    }
  },
);

export default router;
