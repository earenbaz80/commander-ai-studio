/**
 * Identidad de la sesión: usuario registrado o visitante.
 *
 * El modal de acceso solo aparece en la PRIMERA ejecución (o si el usuario
 * elige "cambiar"). El nombre del visitante se guarda en localStorage.
 */

import { useState, useEffect, useCallback } from 'react';

const SEEN_KEY = 'ai_studio_onboarding_seen';
const GUEST_KEY = 'ai_studio_guest_name';

const ADJ = ['Veloz', 'Nitro', 'Cibernético', 'Fénix', 'Sombra', 'Turbo', 'Quantum', 'Nova', 'Rayo', 'Zafiro', 'Órbita', 'Pixel'];
const NOUN = ['Comandante', 'Explorador', 'Arquitecto', 'Navegante', 'Guardián', 'Codificador', 'Pionero', 'Operador'];

/** Nombre de invitado aleatorio y estable por instalación. */
export function generateGuestName(): string {
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const noun = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${adj} ${noun}`;
}

export function useIdentity() {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [guestName, setGuestName] = useState<string>('');

  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY) === '1';
      setHasSeenOnboarding(seen);
      setIsOpen(!seen);
      setGuestName(localStorage.getItem(GUEST_KEY) || '');
    } catch {
      setHasSeenOnboarding(false);
      setIsOpen(true);
    }
  }, []);

  /** Cierra el onboarding como invitado, memorizando el nombre elegido. */
  const continueAsGuest = useCallback((name?: string) => {
    const final = (name || '').trim() || generateGuestName();
    try {
      localStorage.setItem(GUEST_KEY, final);
      localStorage.setItem(SEEN_KEY, '1');
    } catch { /* ignore */ }
    setGuestName(final);
    setHasSeenOnboarding(true);
    setIsOpen(false);
  }, []);

  /** Marca el onboarding como visto (tras registrarse o iniciar sesión). */
  const markSeen = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    setHasSeenOnboarding(true);
    setIsOpen(false);
  }, []);

  /** Permite volver a abrir el selector ("cambiar de usuario"). */
  const reopen = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { hasSeenOnboarding, isOpen, guestName, continueAsGuest, markSeen, reopen, close };
}

export type Identity = ReturnType<typeof useIdentity>;
