/**
 * Setup global de la suite de UI.
 * - Polyfills de APIs ausentes en jsdom (ResizeObserver, matchMedia, scrollIntoView).
 * - Limpieza automática entre tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Firestore real abre un canal gRPC en jsdom que acaba lanzando «process is not
// defined» en mitad de otro test y tumba la corrida. La suite de UI no habla
// con Firestore, así que se mockea una vez aquí y no en cada archivo que pinta
// App; mockearlo sólo en un test dejaba la fuga al resto.
vi.mock('firebase/firestore', () => {
  // Stubs suficientes para que `src/lib/firebase` cargue entero (pide
  // getFirestore, doc, setDoc, getDocFromServer…) sin abrir un canal gRPC.
  const fakeDoc = { id: 'mock-doc', exists: () => false, data: () => ({}) };
  const snapshot = { docs: [], size: 0, empty: true, forEach: () => {} };
  return {
    getFirestore: vi.fn(() => ({})),
    initializeFirestore: vi.fn(() => ({})),
    collection: vi.fn(() => ({ id: 'mock-collection' })),
    doc: vi.fn(() => fakeDoc),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn().mockResolvedValue(fakeDoc),
    getDocFromServer: vi.fn().mockResolvedValue(fakeDoc),
    getDocs: vi.fn().mockResolvedValue(snapshot),
    query: vi.fn(() => ({})),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    addDoc: vi.fn().mockResolvedValue({ id: 'mock-doc' }),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    increment: vi.fn((n: number) => n),
    serverTimestamp: vi.fn(() => new Date(0)),
  };
});

// jsdom no implementa ResizeObserver (lo usa el anclaje de Nono y paneles redimensionables)
if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom no implementa IntersectionObserver
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

// jsdom no implementa matchMedia (prefers-reduced-motion)
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as any;
}

// jsdom no implementa scrollIntoView (lo usan los chats al recibir mensajes)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// jsdom no implementa la Web Speech API (la usa LiveVoiceModal)
if (!('speechSynthesis' in window)) {
  (window as any).speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => []),
    speaking: false,
    pending: false,
    paused: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

if (typeof (globalThis as any).SpeechSynthesisUtterance === 'undefined') {
  (globalThis as any).SpeechSynthesisUtterance = class {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
