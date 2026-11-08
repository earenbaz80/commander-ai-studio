import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtifactsView } from '../../src/components/panel/ArtifactsView';
import {
  clearArtifacts,
  getArtifact,
  saveArtifact,
} from '../../src/artifacts/store';
import type { Artifact, ArtifactFrame } from '../../src/artifacts/types';

function makeFrame(seq: number, atMs: number): ArtifactFrame {
  return {
    seq,
    ts: 1_000 + atMs,
    atMs,
    mimeType: 'image/jpeg',
    data: 'aGVsbG8=',
    width: 800,
    height: 600,
    url: 'https://app.test/',
    title: 'App',
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'rec-1',
    kind: 'browser-recording',
    projectPath: 'C:/tmp/x',
    title: 'Checkout roto',
    createdAt: 1_700_000_000_000,
    durationMs: 1_400,
    sessionId: 'b1',
    viewport: { width: 1280, height: 800 },
    frames: [makeFrame(1, 0), makeFrame(2, 700), makeFrame(3, 1_400)],
    comments: [],
    ...overrides,
  };
}

describe('ArtifactsView', () => {
  beforeEach(async () => {
    await clearArtifacts();
  });

  test('sin grabaciones muestra el estado vacío y abre el navegador', async () => {
    const onOpenBrowser = vi.fn();
    render(<ArtifactsView projectPath="C:/tmp/x" onOpenBrowser={onOpenBrowser} />);

    expect(await screen.findByText('Todavía no hay artifacts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Abrir navegador'));
    expect(onOpenBrowser).toHaveBeenCalledOnce();
  });

  test('muestra la grabación, sus frames y sus metadatos', async () => {
    await saveArtifact(makeArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    expect(await screen.findAllByText('Checkout roto')).not.toHaveLength(0);
    expect(screen.getByText(/3 frames/)).toBeInTheDocument();
    expect(screen.getByText(/1280×800/)).toBeInTheDocument();
    expect(screen.getByText(/FRAME 1\/3/)).toBeInTheDocument();
    expect(screen.getByAltText('Fotograma de la grabación')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,aGVsbG8='
    );
    expect(screen.getByTestId('artifact-play')).toBeInTheDocument();
  });

  test('ancla un comentario al fotograma y lo persiste', async () => {
    await saveArtifact(makeArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    await screen.findByTestId('artifact-add-comment');
    fireEvent.click(screen.getByTestId('artifact-add-comment'));
    fireEvent.change(screen.getByTestId('artifact-comment-input'), {
      target: { value: 'El botón de pago no responde' },
    });
    fireEvent.click(screen.getByTestId('artifact-comment-submit'));

    expect(await screen.findByText('El botón de pago no responde')).toBeInTheDocument();
    expect(screen.getByLabelText(/Comentario 1: El botón de pago no responde/)).toBeInTheDocument();

    await waitFor(async () => {
      const saved = await getArtifact('rec-1');
      expect(saved?.comments).toHaveLength(1);
      expect(saved?.comments[0]).toMatchObject({
        body: 'El botón de pago no responde',
        atMs: 0,
        x: 0.5,
        y: 0.45,
        resolved: false,
      });
    });
  });

  test('resuelve un comentario y actualiza el artifact guardado', async () => {
    await saveArtifact(
      makeArtifact({
        comments: [
          {
            id: 'c1',
            atMs: 700,
            x: 0.3,
            y: 0.4,
            body: 'Aquí falta el loader',
            author: 'local',
            createdAt: 1_700_000_000_100,
            resolved: false,
          },
        ],
      })
    );
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    await screen.findByText('Aquí falta el loader');
    fireEvent.click(screen.getByLabelText('Resolver comentario'));

    await waitFor(async () => {
      const saved = await getArtifact('rec-1');
      expect(saved?.comments[0]?.resolved).toBe(true);
    });
    expect(screen.getByLabelText('Reabrir comentario')).toBeInTheDocument();
  });

  test('el filtro de proyecto no mezcla grabaciones de otro workspace', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeArtifact({ id: 'rec-2', projectPath: 'C:/tmp/otro', title: 'Otra app' }));
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    expect(await screen.findAllByText('Checkout roto')).not.toHaveLength(0);
    expect(screen.queryByText('Otra app')).toBeNull();
  });
});
