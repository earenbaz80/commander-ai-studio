/**
 * Aislamiento del código generado por el modelo en ChatLiveAppViewerModal.
 * El HTML generado no debe compartir origen con la app: sin `allow-same-origin`
 * no puede llamar a /api/agent/run-tool ni leer /api/keys con las cookies de la sesión.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatLiveAppViewerModal, type ChatCodeSnippet } from '../../src/components/ChatLiveAppViewerModal';

const snippets: ChatCodeSnippet[] = [
  { id: 's1', code: '<html><body><h1>hola</h1></body></html>', language: 'html' },
];

const renderModal = () =>
  render(<ChatLiveAppViewerModal isOpen onClose={() => {}} snippets={snippets} lang="es" />);

describe('ChatLiveAppViewerModal: aislamiento del código generado', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('el iframe de vista previa tiene sandbox sin allow-same-origin', () => {
    renderModal();
    const iframe = screen.getByTitle('Chat Live Sandbox');
    const flags = (iframe.getAttribute('sandbox') || '').split(/\s+/);
    expect(flags).toContain('allow-scripts');
    expect(flags).not.toContain('allow-same-origin');
  });

  test('abrir en ventana nueva envuelve el HTML en un iframe sandboxed', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return 'blob:test';
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    renderModal();
    fireEvent.click(screen.getByTitle('Abrir en Pestaña / Ventana Externa'));

    expect(blobs).toHaveLength(1);
    const html = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
    expect(html).toContain('<iframe sandbox="allow-scripts allow-forms allow-modals"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('srcdoc=');
  });
});
