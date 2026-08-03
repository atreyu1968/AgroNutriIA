import { and, eq, lt } from "drizzle-orm";
import { db, reportsTable } from "@workspace/db";
import { logger } from "./logger";

/** Reports stuck in "generating" longer than this are marked as "error". */
export const STALE_REPORT_MINUTES = 10;

const SWEEP_INTERVAL_MS = 60_000;

export async function failStaleReports(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_REPORT_MINUTES * 60_000);
  const stale = await db
    .update(reportsTable)
    .set({ status: "error" })
    .where(
      and(eq(reportsTable.status, "generating"), lt(reportsTable.createdAt, cutoff)),
    )
    .returning({ id: reportsTable.id });
  if (stale.length > 0) {
    logger.warn(
      { reportIds: stale.map((r) => r.id), staleMinutes: STALE_REPORT_MINUTES },
      "Marked stale generating reports as error",
    );
  }
  return stale.length;
}

export function startReportSweeper(): void {
  const run = () =>
    failStaleReports().catch((err: Error) =>
      logger.error({ err: err.message }, "Report sweeper failed"),
    );
  void run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
}
