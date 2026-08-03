import { db, auditLogTable } from "@workspace/db";

export async function audit(entry: {
  userId?: number | null;
  farmId?: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  detail?: string | null;
}): Promise<void> {
  await db.insert(auditLogTable).values(entry);
}
