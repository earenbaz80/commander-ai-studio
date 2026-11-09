import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtifactsView } from '../../src/components/panel/ArtifactsView';
import {
  clearArtifacts,
  getArtifact,
  listArtifacts,
  saveArtifact,
} from '../../src/artifacts/store';
import {
  isBrowserRecordingArtifact,
  type ArtifactFrame,
  type BrowserRecordingArtifact,
  type VerificationArtifact,
} from '../../src/artifacts/types';

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

function makeArtifact(overrides: Partial<BrowserRecordingArtifact> = {}): BrowserRecordingArtifact {
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

function makeVerificationArtifact(
  overrides: Partial<VerificationArtifact> = {}
): VerificationArtifact {
  return {
    id: 'ver-1',
    kind: 'verification',
    schemaVersion: 1,
    projectPath: 'C:/tmp/x',
    title: 'Verificación checkout',
    createdAt: 1_700_000_100_000,
    sessionId: 's1',
    status: 'failed',
    plan: [
      {
        id: 'p1',
        text: 'Reproducir el fallo',
        status: 'done',
        done: true,
        files: ['src/checkout.ts'],
        criteria: 'test rojo',
      },
      {
        id: 'p2',
        text: 'Corregir el cálculo',
        status: 'in_progress',
        done: false,
      },
    ],
    decisions: [
      {
        stepId: 'step-1',
        tool: 'fs.edit',
        decision: 'allow',
        reason: 'cambio revisado',
      },
      { stepId: 'step-2', tool: 'shell.run', decision: 'deny' },
    ],
    diff: {
      patch:
        '--- a/src/checkout.ts\n+++ b/src/checkout.ts\n@@ -1 +1 @@\n-export const total = 2;\n+export const total = 3;',
      files: ['src/checkout.ts'],
      base: 'main',
      head: 'fix/checkout',
    },
    tests: [
      {
        id: 't1',
        command: 'npm test -- checkout',
        cwd: 'C:/tmp/x',
        status: 'failed',
        exitCode: 1,
        durationMs: 1_200,
        startedAt: 1_700_000_000_100,
        finishedAt: 1_700_000_001_300,
        stdoutTail: '1 failing',
        stderrTail: 'AssertionError: expected 2 to be 3',
      },
    ],
    browserRecordingId: 'rec-1',
    environment: {
      node: 'v22.0.0',
      os: 'win32-x64',
      commit: 'abc123',
      branch: 'main',
    },
    report: {
      format: 'markdown',
      content: '# Informe de verificación\n\nEl test falló.',
      generatedAt: 1_700_000_200_000,
    },
    ...overrides,
  };
}

describe('ArtifactsView', () => {
  beforeEach(async () => {
    await clearArtifacts();
  });

  afterEach(() => {
    delete window.electronAPI;
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
      const comments = saved && isBrowserRecordingArtifact(saved) ? saved.comments : [];
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
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
      const comments = saved && isBrowserRecordingArtifact(saved) ? saved.comments : [];
      expect(comments[0]?.resolved).toBe(true);
    });
    expect(screen.getByLabelText('Reabrir comentario')).toBeInTheDocument();
  });

  test('el filtro de proyecto no mezcla grabaciones de otro workspace', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeArtifact({ id: 'rec-2', projectPath: 'C:/tmp/otro', title: 'Otra app' }));
    await saveArtifact(
      makeVerificationArtifact({
        id: 'ver-2',
        projectPath: 'C:/tmp/otro',
        title: 'Verificación otra',
      })
    );
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    expect(await screen.findAllByText('Checkout roto')).not.toHaveLength(0);
    expect(screen.queryByText('Otra app')).toBeNull();
    expect(screen.queryByText('Verificación otra')).toBeNull();
  });

  test('muestra el detalle de verificación con plan, diff, tests, entorno e informe', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    expect(await screen.findByTestId('verification-detail')).toBeInTheDocument();
    expect(screen.getByText('Reproducir el fallo')).toBeInTheDocument();
    expect(screen.getByText(/cambio revisado/)).toBeInTheDocument();
    expect(screen.getByTestId('verification-diff')).toHaveTextContent(
      '+export const total = 3;'
    );
    expect(screen.getByTestId('verification-test-t1')).toHaveTextContent('FALLÓ');
    expect(screen.getByTestId('verification-test-t1')).toHaveTextContent('exitCode: 1');
    expect(screen.getByTestId('verification-test-t1')).toHaveTextContent(
      'AssertionError: expected 2 to be 3'
    );
    expect(screen.getByText('v22.0.0')).toBeInTheDocument();
    expect(screen.getByTestId('verification-recording')).toHaveTextContent(
      'Checkout roto'
    );
    expect(screen.getByTestId('verification-recording')).toHaveTextContent('3 frames');
    expect(screen.getByTestId('verification-recording-id')).toHaveTextContent('rec-1');
    expect(screen.getByTestId('verification-report-recording')).toBeInTheDocument();
    expect(screen.getByTestId('verification-report')).toHaveTextContent(
      'El test falló'
    );
  });

  test('enlaza la verificación con su grabación y la abre sin duplicar frames', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    const link = await screen.findByTestId('verification-open-recording');
    expect(screen.getByTestId('verification-recording')).toHaveTextContent('Checkout roto');
    expect(screen.getByTestId('verification-report-recording')).toBeInTheDocument();

    fireEvent.click(link);

    expect(await screen.findByTestId('artifact-play')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const stored = await listArtifacts('C:/tmp/x');
    expect(stored).toHaveLength(2);
    const recording = stored.find(isBrowserRecordingArtifact);
    expect(recording?.frames).toHaveLength(3);
    const verification = stored.find((entry) => entry.id === 'ver-1');
    expect(verification).toBeDefined();
    expect(verification).not.toHaveProperty('frames');
  });

  test('una grabación borrada deja el detalle en «no disponible» sin romper el artifact', async () => {
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    const missing = await screen.findByTestId('verification-recording-missing');
    expect(missing).toHaveTextContent('Grabación no disponible');
    expect(missing).toHaveTextContent('rec-1');
    expect(screen.getByTestId('verification-report')).toBeInTheDocument();
    expect(screen.queryByTestId('verification-open-recording')).toBeNull();
    expect(screen.queryByTestId('verification-report-recording')).toBeNull();
  });

  test('sin browserRecordingId no inventa una grabación', async () => {
    await saveArtifact(makeVerificationArtifact({ browserRecordingId: undefined }));
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    expect(await screen.findByTestId('verification-detail')).toHaveTextContent(
      'Sin grabación vinculada'
    );
    expect(screen.queryByTestId('verification-recording')).toBeNull();
    expect(screen.queryByTestId('verification-recording-missing')).toBeNull();
  });

  test('borrar la grabación desde el visor conserva el artifact de verificación', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    fireEvent.click(await screen.findByTestId('artifact-card-rec-1'));
    fireEvent.click(await screen.findByLabelText('Eliminar artifact'));
    fireEvent.click(screen.getByText('Sí'));

    expect(await screen.findByTestId('verification-recording-missing')).toBeInTheDocument();
    expect(await getArtifact('ver-1')).not.toBeNull();
    expect(await getArtifact('rec-1')).toBeNull();
    expect(screen.getByTestId('verification-report')).toBeInTheDocument();
  });

  test('genera y persiste el informe Markdown si el artifact no lo trae', async () => {
    await saveArtifact(makeVerificationArtifact({ report: undefined }));
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    fireEvent.click(await screen.findByTestId('verification-generate-report'));
    expect(await screen.findByTestId('verification-report')).toHaveTextContent(
      'Verificación checkout'
    );

    await waitFor(async () => {
      const saved = await getArtifact('ver-1');
      expect(saved?.kind).toBe('verification');
      if (saved?.kind === 'verification') {
        expect(saved.report?.format).toBe('markdown');
        expect(saved.report?.content).toContain('FALLÓ');
      }
    });
  });

  test('filtra por tipo sin mezclar grabaciones y verificaciones', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    expect(await screen.findAllByText('Checkout roto')).not.toHaveLength(0);
    expect(await screen.findAllByText('Verificación checkout')).not.toHaveLength(0);

    fireEvent.click(screen.getByTestId('artifact-filter-verification'));
    await waitFor(() => expect(screen.queryByTestId('artifact-card-rec-1')).toBeNull());
    expect(screen.getByTestId('artifact-card-ver-1')).toBeInTheDocument();
    expect(screen.getAllByText('Verificación checkout').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('artifact-filter-browser-recording'));
    await waitFor(() => expect(screen.queryByTestId('artifact-card-ver-1')).toBeNull());
    expect(screen.getByTestId('artifact-card-rec-1')).toBeInTheDocument();
  });

  test('el enlace del informe abre la misma grabación', async () => {
    await saveArtifact(makeArtifact());
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    fireEvent.click(await screen.findByTestId('verification-report-recording'));

    expect(await screen.findByTestId('artifact-play')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('el estado vacío distingue «sin grabaciones» de «sin verificaciones»', async () => {
    await saveArtifact(makeArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    await screen.findAllByText('Checkout roto');
    fireEvent.click(screen.getByTestId('artifact-filter-verification'));

    expect(await screen.findByTestId('artifacts-filter-empty')).toHaveTextContent(
      'No hay verificaciones en este proyecto'
    );
  });

  test('abre la carpeta local del artifact con el puente nativo', async () => {
    const openFolder = vi.fn(async () => ({ success: true }));
    window.electronAPI = { app: { openFolder } } as any;
    await saveArtifact(makeVerificationArtifact());
    render(<ArtifactsView projectPath="C:/tmp/x" />);

    fireEvent.click(await screen.findByTestId('verification-open-folder'));

    await waitFor(() => expect(openFolder).toHaveBeenCalledWith('C:/tmp/x'));
    expect(await screen.findByTestId('verification-folder-status')).toHaveTextContent(
      'Carpeta abierta'
    );
  });
});
