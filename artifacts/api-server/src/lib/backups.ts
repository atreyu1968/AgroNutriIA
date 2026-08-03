import { spawn } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import type { Installation } from "@workspace/db";
import { logger } from "./logger";

/**
 * Copias de seguridad por cooperativa.
 *
 * En producción, con BACKUP_SCRIPT (ruta a deploy/backup-coop.sh) definido,
 * se ejecuta el script real que hace pg_dump/pg_restore de la base de datos
 * de la instalación. Sin esa variable (desarrollo/Replit), la copia se genera
 * como un fichero simulado para poder probar el flujo completo.
 */

const FILE_RE = /^[a-z0-9-]+-\d{8}-\d{6}(-subida)?\.dump$/;

export function backupDir(subdomain: string): string {
  const base = process.env.BACKUP_DIR?.trim() || "/tmp/agronutri-backups";
  return path.join(base, subdomain);
}

/** Valida un nombre de fichero de copia (sin rutas, formato conocido). */
export function isValidBackupFileName(name: string): boolean {
  return FILE_RE.test(name) && !name.includes("/") && !name.includes("..");
}

export function newBackupFileName(subdomain: string, uploaded = false): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14)
    .replace(/^(\d{8})(\d{6})$/, "$1-$2");
  return `${subdomain}-${ts}${uploaded ? "-subida" : ""}.dump`;
}

export type BackupFile = { fileName: string; sizeBytes: number; createdAt: string };

export async function listBackups(subdomain: string): Promise<BackupFile[]> {
  const dir = backupDir(subdomain);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of entries) {
    if (!isValidBackupFileName(name)) continue;
    const st = await fs.stat(path.join(dir, name));
    out.push({ fileName: name, sizeBytes: st.size, createdAt: st.mtime.toISOString() });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function runScript(args: string[]): Promise<{ ok: boolean; output: string }> {
  const script = process.env.BACKUP_SCRIPT!.trim();
  // El servicio corre como usuario sin privilegios; el script necesita root
  // (sudo -u postgres y systemctl). install.sh instala una regla sudoers
  // restringida exactamente a este script.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const [cmd, cmdArgs] = isRoot
    ? ["bash", [script, ...args]]
    : ["sudo", ["-n", "bash", script, ...args]];
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { env: process.env });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
    child.on("error", (err) => resolve({ ok: false, output: String(err) }));
  });
}

export function backupsSimulated(): boolean {
  return !process.env.BACKUP_SCRIPT?.trim();
}

/** Crea una copia de seguridad y devuelve su ficha. */
export async function createBackup(inst: Installation): Promise<BackupFile> {
  const dir = backupDir(inst.subdomain);
  await fs.mkdir(dir, { recursive: true });
  const fileName = newBackupFileName(inst.subdomain);
  const filePath = path.join(dir, fileName);
  if (backupsSimulated()) {
    await fs.writeFile(
      filePath,
      `-- Copia simulada de ${inst.subdomain} (${new Date().toISOString()}).\n` +
        `-- En producción, con BACKUP_SCRIPT configurado, este fichero es un pg_dump real.\n`,
    );
    logger.info({ subdomain: inst.subdomain, fileName }, "Simulated backup created");
  } else {
    const { ok, output } = await runScript([inst.subdomain, "dump", filePath]);
    if (!ok) throw new Error(output || "El script de copia de seguridad falló");
    logger.info({ subdomain: inst.subdomain, fileName }, "Backup created");
  }
  const st = await fs.stat(filePath);
  return { fileName, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
}

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/**
 * Guarda un fichero subido como copia disponible, en streaming (sin cargar
 * el fichero completo en memoria) y con límite de tamaño.
 */
export async function saveUploadedBackupStream(
  inst: Installation,
  stream: NodeJS.ReadableStream,
): Promise<BackupFile> {
  const dir = backupDir(inst.subdomain);
  await fs.mkdir(dir, { recursive: true });
  const fileName = newBackupFileName(inst.subdomain, true);
  const filePath = path.join(dir, fileName);
  let bytes = 0;
  const out = createWriteStream(filePath, { flags: "wx", mode: 0o640 });
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES) {
          stream.pause();
          reject(new Error("El fichero supera el tamaño máximo (512 MB)"));
          return;
        }
        if (!out.write(chunk)) {
          stream.pause();
          out.once("drain", () => stream.resume());
        }
      });
      stream.on("end", () => out.end(resolve));
      stream.on("error", reject);
      out.on("error", reject);
    });
  } catch (err) {
    out.destroy();
    await fs.rm(filePath, { force: true });
    throw err;
  }
  if (bytes === 0) {
    await fs.rm(filePath, { force: true });
    throw new Error("El fichero está vacío");
  }
  const st = await fs.stat(filePath);
  return { fileName, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
}

/** Restaura la base de datos de la instalación desde una copia existente. */
export async function restoreBackup(inst: Installation, fileName: string): Promise<string> {
  if (!isValidBackupFileName(fileName)) throw new Error("Nombre de copia no válido");
  const filePath = path.join(backupDir(inst.subdomain), fileName);
  await fs.access(filePath);
  if (backupsSimulated()) {
    logger.info({ subdomain: inst.subdomain, fileName }, "Simulated restore");
    return "Restauración simulada (BACKUP_SCRIPT no configurado en este entorno)";
  }
  const { ok, output } = await runScript([inst.subdomain, "restore", filePath]);
  if (!ok) throw new Error(output || "El script de restauración falló");
  logger.info({ subdomain: inst.subdomain, fileName }, "Backup restored");
  return output;
}
