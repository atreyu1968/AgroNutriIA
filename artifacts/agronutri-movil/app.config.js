// Extiende app.json: permite exportar la versión web bajo una sub-ruta
// (p. ej. /movil en el servidor propio) fijando BASE_PATH al exportar:
//   BASE_PATH=/movil npx expo export --platform web
module.exports = ({ config }) => {
  const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');
  if (basePath && basePath !== '/') {
    config.experiments = { ...(config.experiments || {}), baseUrl: basePath };
  }
  return config;
};
