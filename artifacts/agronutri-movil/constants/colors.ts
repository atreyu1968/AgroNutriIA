/**
 * AgroNutri brand tokens — sincronizados con artifacts/agronutri/src/index.css
 * (variables CSS :root en HSL, aquí convertidas a HEX).
 * Verde hoja de platanera (primary) + ámbar atlántico (secondary) sobre
 * crema volcánica (background).
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#141d24',
    tint: '#122c3f',

    // Core surfaces — crema volcánica
    background: '#f7f3ee',
    foreground: '#141d24',

    // Cards / elevated surfaces
    card: '#fcfaf8',
    cardForeground: '#141d24',

    // Primary — verde hoja de platanera, profundo
    primary: '#122c3f',
    primaryForeground: '#faf8f5',

    // Secondary — ámbar hora dorada atlántica
    secondary: '#f19722',
    secondaryForeground: '#0f1b24',

    // Muted — arena clara
    muted: '#ebe7e0',
    mutedForeground: '#4c5861',

    // Accent — ámbar claro (fondos suaves)
    accent: '#f7e8d3',
    accentForeground: '#5f371b',

    // Destructive
    destructive: '#ad3a29',
    destructiveForeground: '#faf8f5',

    // Borders / inputs
    border: '#ded8cf',
    input: '#ded8cf',

    // Extra semantic tones
    success: '#1a7a4a',
    warning: '#b8860b',
    basalt: '#141d24',

    // Tintes para insignias/iconos (derivados del primary y accent)
    primaryTint: '#dde8e0',
    accentTint: '#f7e8d3',
  },

  radius: 14,
};

export default colors;
