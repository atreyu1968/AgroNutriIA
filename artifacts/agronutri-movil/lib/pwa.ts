/**
 * Utilidades PWA para la versión web de AgroNutri Móvil.
 * En nativo todo son no-ops.
 *
 * La app se sirve bajo una subruta (/movil en servidores propios), así que la
 * ruta base se deduce de la URL del bundle JS (…/_expo/static/…), que siempre
 * lleva el prefijo correcto tanto en Replit como en el servidor del cliente.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

declare global {
  interface Window {
    __agronutriPwaPrompt?: BeforeInstallPromptEvent | null;
    __agronutriPwaListeners?: Array<() => void>;
  }
}

/** Prefijo de montaje de la app web, con barra final ('/movil/' o '/'). */
export function getWebBasePath(): string {
  if (typeof document === 'undefined') return '/';
  const script = document.querySelector('script[src*="_expo/static"]');
  const src = script?.getAttribute('src');
  if (src) {
    try {
      const match = new URL(src, window.location.origin).pathname.match(/^(.*)\/_expo\//);
      if (match) return `${match[1]}/`;
    } catch {
      // fall through
    }
  }
  return '/';
}

// Captura beforeinstallprompt lo antes posible (al importar el módulo), porque
// Chrome puede dispararlo antes de que React monte los componentes.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    window.__agronutriPwaPrompt = event as BeforeInstallPromptEvent;
    (window.__agronutriPwaListeners ?? []).forEach((cb) => cb());
  });
  window.addEventListener('appinstalled', () => {
    window.__agronutriPwaPrompt = null;
    (window.__agronutriPwaListeners ?? []).forEach((cb) => cb());
  });
}

/** Inyecta el manifiesto y registra el service worker. Llamar una vez (web). */
export function setupPwa(): void {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
  const base = getWebBasePath();

  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `${base}manifest.json`;
    document.head.appendChild(link);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Sin service worker la app funciona igual; solo se pierde la caché offline.
    });
  }
}

/** Prompt de instalación capturado, o null si el navegador no lo ha ofrecido. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  return window.__agronutriPwaPrompt ?? null;
}

export function onInstallPromptChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.__agronutriPwaListeners = window.__agronutriPwaListeners ?? [];
  window.__agronutriPwaListeners.push(cb);
  return () => {
    window.__agronutriPwaListeners = (window.__agronutriPwaListeners ?? []).filter((f) => f !== cb);
  };
}

/** True si la app ya corre instalada (standalone / pantalla de inicio). */
export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** iOS no soporta beforeinstallprompt: hay que guiar al usuario a mano. */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !isInstalledPwa();
}
