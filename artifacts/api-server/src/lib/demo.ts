/**
 * Modo demostración (instancia "Prueba Coop" para posibles clientes).
 *
 * Con DEMO_MODE=true en el entorno, la instancia limita el uso:
 *   - Una sola finca en total.
 *   - Un informe de cada tipo (fertirrigación, enmiendas) en total.
 *
 * Se activa por instalación: el aprovisionador (provision-coop.sh) escribe
 * DEMO_MODE=true en el fichero de entorno de la instancia demo.
 */
export function demoMode(): boolean {
  const v = process.env.DEMO_MODE?.trim().toLowerCase();
  return v === "true" || v === "1";
}

export const DEMO_FARM_LIMIT_MESSAGE =
  "Esta es una instalación de demostración limitada a una sola finca. " +
  "Contrata AgroNutri AI para gestionar todas tus fincas.";

export const DEMO_REPORT_LIMIT_MESSAGE =
  "Esta es una instalación de demostración limitada a un informe de cada tipo. " +
  "Contrata AgroNutri AI para generar informes sin límite.";
