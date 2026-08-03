import { test, after } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, usersTable, phytoProductsTable } from "@workspace/db";
import { canMutateProduct, isValidSourceUrl } from "./phyto";

// Autorización de escrituras en el catálogo compartido de fitosanitarios:
// sobrescribir una entrada existente exige ser administrador o su creador,
// y las URLs de fuente deben ser http(s) absolutas (evita XSS almacenado).

const createdUserIds: number[] = [];
const createdProductIds: number[] = [];

after(async () => {
  if (createdProductIds.length) {
    await db.delete(phytoProductsTable).where(inArray(phytoProductsTable.id, createdProductIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

test("solo el admin o el creador pueden sobrescribir un producto del catálogo", async () => {
  const ts = Date.now();
  const [owner] = await db
    .insert(usersTable)
    .values({ email: `phyto-owner-${ts}@example.com`, passwordHash: "x", name: "Creador" })
    .returning();
  const [other] = await db
    .insert(usersTable)
    .values({ email: `phyto-other-${ts}@example.com`, passwordHash: "x", name: "Otro" })
    .returning();
  createdUserIds.push(owner.id, other.id);

  const [product] = await db
    .insert(phytoProductsTable)
    .values({ productName: `Producto authz ${ts}`, createdBy: owner.id })
    .returning();
  createdProductIds.push(product.id);

  // Misma política que aplica POST /phyto/products antes de upsert.
  assert.equal(canMutateProduct({ id: other.id, isAdmin: false }, product), false);
  assert.equal(canMutateProduct({ id: owner.id, isAdmin: false }, product), true);
  assert.equal(canMutateProduct({ id: other.id, isAdmin: true }, product), true);
  // Crear un producto nuevo (sin entrada existente) está permitido.
  assert.equal(canMutateProduct({ id: other.id, isAdmin: false }, undefined), true);
});

test("las URLs de fuente solo se aceptan si son http(s) absolutas", () => {
  assert.equal(isValidSourceUrl("https://www.mapa.gob.es/registro"), true);
  assert.equal(isValidSourceUrl("http://example.com/ficha.pdf"), true);
  assert.equal(isValidSourceUrl("javascript:alert(1)"), false);
  assert.equal(isValidSourceUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isValidSourceUrl("ftp://example.com/x"), false);
  assert.equal(isValidSourceUrl("no-es-una-url"), false);
  assert.equal(isValidSourceUrl("//example.com/relativa"), false);
});
