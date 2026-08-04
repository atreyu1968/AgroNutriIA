import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from '@/components/ui/use-toast';

// Cada cuánto se comprueba si hay una versión nueva con la pestaña abierta.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

/**
 * Aviso de nueva versión: con el service worker en modo 'prompt', cuando hay
 * una versión nueva mientras la pestaña sigue abierta, muestra un toast
 * persistente con un botón para recargar y aplicar la actualización.
 */
export function UpdatePrompt() {
  const shown = useRef(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Además de en cada navegación, comprobar actualizaciones cada hora
      // para sesiones largas (pestañas abiertas todo el día).
      setInterval(() => {
        registration.update().catch(() => {
          // Sin conexión o fallo puntual: se reintentará en el siguiente ciclo.
        });
      }, CHECK_INTERVAL_MS);
    },
  });

  useEffect(() => {
    if (!needRefresh || shown.current) return;
    shown.current = true;
    toast({
      title: 'Nueva versión disponible',
      description: 'Recarga para usar la última versión de AgroNutri.',
      duration: Infinity,
      action: (
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Recargar
        </button>
      ),
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
