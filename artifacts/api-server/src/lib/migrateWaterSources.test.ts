/**
 * Prueba de actualización del despliegue: una base de datos con el esquema
 * antiguo (columnas has_desalinated_water / desalinated_water_pct en farms)
 * debe conservar el porcentaje como fuente de agua «Desaladora» tras ejecutar
 * deploy/migrate-water-sources.sql (que corre antes de `drizzle push`).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, eq, and } from "drizzle-orm";
import { db, usersTable, farmsTable, waterSourcesTable } from "@workspace/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  path.resolve(here, "../../../../deploy/migrate-water-sources.sql"),
  "utf8",
);

let userId: number;
let farmId: number;

before(async () => {
  // Recrea el esquema antiguo (columnas legadas) sobre la BD actual.
  await db.execute(sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS has_desalinated_water boolean`);
  await db.execute(sql`ALTER TABLE farms ADD COLUMN IF NOT EXISTS desalinated_water_pct real`);
  const [user] = await db
    .insert(usersTable)
    .values({ email: `migr-${randomUUID()}@test.local`, passwordHash: "x", name: "Migr", role: "owner" })
    .returning();
  userId = user.id;
  const [farm] = await db
    .insert(farmsTable)
    .values({ ownerId: userId, name: `Finca migración ${randomUUID().slice(0, 6)}` })
    .returning();
  farmId = farm.id;
  await db.execute(
    sql`UPDATE farms SET has_desalinated_water = true, desalinated_water_pct = 35 WHERE id = ${farmId}`,
  );
});

after(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, userId)); // cascada: farm + fuentes
  await db.execute(sql`ALTER TABLE farms DROP COLUMN IF EXISTS has_desalinated_water`);
  await db.execute(sql`ALTER TABLE farms DROP COLUMN IF EXISTS desalinated_water_pct`);
});

test("la migración crea la fuente «Desaladora» con el % antiguo", async () => {
  await db.execute(sql.raw(migrationSql));
  const rows = await db
    .select()
    .from(waterSourcesTable)
    .where(eq(waterSourcesTable.farmId, farmId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Desaladora");
  assert.equal(rows[0].sharePct, 35);
});

test("la migración es idempotente (no duplica la fuente)", async () => {
  await db.execute(sql.raw(migrationSql));
  await db.execute(sql.raw(migrationSql));
  const rows = await db
    .select()
    .from(waterSourcesTable)
    .where(
      and(eq(waterSourcesTable.farmId, farmId), eq(waterSourcesTable.name, "Desaladora")),
    );
  assert.equal(rows.length, 1);
});
