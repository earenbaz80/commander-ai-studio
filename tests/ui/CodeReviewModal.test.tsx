import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeReviewModal } from '../../src/components/panel/CodeReviewModal';
import { runAgentTool, writeProjectFile } from '../../src/utils/agentToolsApi';

vi.mock('../../src/utils/agentToolsApi', () => ({
  runAgentTool: vi.fn(),
  writeProjectFile: vi.fn(),
}));

const mockRun = runAgentTool as unknown as ReturnType<typeof vi.fn>;
const mockWrite = writeProjectFile as unknown as ReturnType<typeof vi.fn>;

const ANALYSIS = {
  file: 'src/a.ts',
  checked: true,
  diagnostics: [
    { file: 'src/a.ts', line: 3, column: 5, severity: 'error', code: 'TS2322', message: 'string no es number' },
  ],
  errorCount: 1,
  warningCount: 0,
  unusedImports: [{ name: 'otra', module: './b', line: 1, column: 10 }],
  rules: [
    {
      rule: 'color-token',
      file: 'src/a.ts',
      line: 4,
      column: 12,
      message: 'Color literal #ff0000: usa un token del tema.',
      excerpt: '#ff0000',
    },
  ],
};

const PLAN = {
  symbol: 'viejo',
  newName: 'nuevo',
  locations: 2,
  files: [
    {
      path: 'src/a.ts',
      changed: true,
      additions: 1,
      deletions: 1,
      diff: '@@ -1 +1 @@\n-viejo\n+nuevo',
      content: 'export const nuevo = 1;\n',
      diagnostics: [],
      checked: true,
    },
  ],
};

function mockTools(renamePlan: unknown = PLAN) {
  mockRun.mockImplementation(async (toolId: string) => {
    if (toolId === 'code.analyze') return { ok: true, data: ANALYSIS };
    if (toolId === 'code.fix') {
      return {
        ok: true,
        data: {
          files: [
            { path: 'src/a.ts', changed: true, additions: 1, deletions: 1, diff: '@@ -1 +1 @@\n-const a=1\n+const a = 1;' },
          ],
        },
      };
    }
    if (toolId === 'code.refactor') return { ok: true, data: renamePlan };
    return { ok: false, error: `tool inesperada: ${toolId}` };
  });
}

function renderModal(props: Partial<{ onClose: () => void; onFileChanged: (p: string) => void }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onFileChanged = props.onFileChanged ?? vi.fn();
  render(
    <CodeReviewModal path="src/a.ts" projectPath="/proj" onClose={onClose} onFileChanged={onFileChanged} />
  );
  return { onClose, onFileChanged };
}

describe('CodeReviewModal', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockWrite.mockReset();
    mockWrite.mockResolvedValue({ ok: true });
    mockTools();
  });

  test('muestra diagnósticos, imports sin usar y reglas del archivo', async () => {
    renderModal();
    expect(await screen.findByText(/TS2322/)).toBeTruthy();
    expect(screen.getByText(/otra/)).toBeTruthy();
    expect(screen.getByText(/color-token/)).toBeTruthy();
    expect(mockRun).toHaveBeenCalledWith('code.analyze', { path: 'src/a.ts' }, '/proj');
  });

  test('formatear llama a code.fix y avisa de que el archivo cambió', async () => {
    const { onFileChanged } = renderModal();
    fireEvent.click(screen.getByTestId('review-fix'));
    await waitFor(() => expect(mockRun).toHaveBeenCalledWith('code.fix', { paths: ['src/a.ts'] }, '/proj'));
    expect(await screen.findByText(/Cambios aplicados/)).toBeTruthy();
    expect(onFileChanged).toHaveBeenCalledWith('src/a.ts');
  });

  test('propone el renombrado y sólo escribe cuando se aplica', async () => {
    const { onFileChanged } = renderModal();
    await screen.findByText(/TS2322/);

    fireEvent.change(screen.getByTestId('review-symbol'), { target: { value: 'viejo' } });
    fireEvent.change(screen.getByTestId('review-new-name'), { target: { value: 'nuevo' } });
    fireEvent.click(screen.getByTestId('review-plan-rename'));

    expect(await screen.findByText('src/a.ts')).toBeTruthy();
    expect(mockWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('review-apply-rename'));
    await waitFor(() =>
      expect(mockWrite).toHaveBeenCalledWith('src/a.ts', 'export const nuevo = 1;\n', '/proj')
    );
    expect(onFileChanged).toHaveBeenCalledWith('src/a.ts');
  });

  test('no deja aplicar un renombrado que deja errores de tipos', async () => {
    mockTools({
      ...PLAN,
      files: [{ ...PLAN.files[0], diagnostics: [{ line: 2, column: 1, message: 'boom', severity: 'error' }] }],
    });
    renderModal();
    await screen.findByText(/TS2322/);

    fireEvent.change(screen.getByTestId('review-symbol'), { target: { value: 'viejo' } });
    fireEvent.change(screen.getByTestId('review-new-name'), { target: { value: 'nuevo' } });
    fireEvent.click(screen.getByTestId('review-plan-rename'));

    expect(await screen.findByText(/no se aplica/)).toBeTruthy();
    expect((screen.getByTestId('review-apply-rename') as HTMLButtonElement).disabled).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
