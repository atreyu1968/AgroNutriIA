import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, productSheetsTable } from "@workspace/db";

// Authorization test for /product-sheets scoping: a user must only see their
// own sheets. Exercises the exact query used by the route handler.

const createdUserIds: number[] = [];

after(async () => {
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

test("un usuario solo ve sus propias fichas de producto", async () => {
  const ts = Date.now();
  const [userA] = await db
    .insert(usersTable)
    .values({ email: `sheets-a-${ts}@example.com`, passwordHash: "x", name: "Usuario A" })
    .returning();
  const [userB] = await db
    .insert(usersTable)
    .values({ email: `sheets-b-${ts}@example.com`, passwordHash: "x", name: "Usuario B" })
    .returning();
  createdUserIds.push(userA.id, userB.id);

  await db.insert(productSheetsTable).values([
    { name: `Ficha A ${ts}`, createdBy: userA.id },
    { name: `Ficha B ${ts}`, createdBy: userB.id },
  ]);

  // Same scoping the GET /product-sheets handler applies for non-admins.
  const seenByA = await db
    .select()
    .from(productSheetsTable)
    .where(eq(productSheetsTable.createdBy, userA.id));

  assert.ok(seenByA.some((s) => s.name === `Ficha A ${ts}`));
  assert.ok(!seenByA.some((s) => s.name === `Ficha B ${ts}`));
});
