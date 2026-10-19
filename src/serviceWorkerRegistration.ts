// Commander AI Studio - Service Worker Registration & Offline Management

export function registerServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    // No registrar SW en Electron/Tauri (file:// o localhost embebido)
    try {
      const host = window.location.hostname;
      const proto = window.location.protocol;
      if (proto === 'file:' || host === '' || (window as any).electronAPI) return;
    } catch { /* sigue */ }
    window.addEventListener('load', () => {
      const swUrl = './sw.js';

      navigator.serviceWorker
        .register(swUrl)
        .then((registration) => {
          console.log('[SW] Service Worker registrado exitosamente con scope:', registration.scope);

          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker == null) return;

            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('[SW] Nueva versión de Commander AI Studio disponible. Se actualizará en la próxima carga.');
                } else {
                  console.log('[SW] Contenido cacheado para uso fuera de línea (Offline Ready).');
                }
              }
            };
          };
        })
        .catch((error) => {
          console.error('[SW] Error al registrar Service Worker:', error);
        });
    });
  }
}

export function unregisterServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}
