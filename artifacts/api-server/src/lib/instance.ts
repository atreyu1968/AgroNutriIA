/**
 * Tipo de instancia de la aplicación.
 *
 * La instalación central (la del vendedor) gestiona las instalaciones de las
 * cooperativas y su facturación. Las instancias aprovisionadas para cada
 * cooperativa se marcan con COOP_INSTANCE=true (lo hace el script de
 * aprovisionamiento) y en ellas se ocultan esas secciones y se deshabilitan
 * sus rutas de API.
 */
export function isCoopInstance(): boolean {
  return process.env.COOP_INSTANCE === "true";
}
