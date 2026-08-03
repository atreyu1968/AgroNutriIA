import app from "./app";
import { logger } from "./lib/logger";
import { startReportSweeper } from "./lib/reportSweeper";
import { startUsageReporter } from "./lib/usageReporter";
import { ensureInvoiceGuards } from "./lib/invoiceGuard";
import { startAutoInvoicer } from "./lib/autoInvoicer";
import { startBillingSweeper } from "./lib/billingSweeper";
import { startVerifactuSubmitter } from "./lib/verifactu";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// HOST=127.0.0.1 en instalaciones propias detrás de nginx; por defecto
// escucha en todas las interfaces (necesario para el proxy de desarrollo).
const host = process.env.HOST ?? "0.0.0.0";

// Instala los triggers que protegen las facturas emitidas contra
// modificaciones o borrados directos en la base de datos. El servidor no
// empieza a escuchar hasta que la protección está instalada (fail closed).
ensureInvoiceGuards()
  .then(() => {
    app.listen(port, host, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startReportSweeper();
      startUsageReporter();
      startAutoInvoicer();
      startBillingSweeper();
      startVerifactuSubmitter();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Error instalando la protección de facturas");
    process.exit(1);
  });
