/**
 * «Auditoría General»: el hook valida el proyecto y entrega el prompt a
 * `onAuditStart`, que lo corre en el chat con herramientas (`useGeneralAudit`).
 * Mandarlo al chat simple sería responder sin leer el proyecto.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useAppPrompts } from '../../src/hooks/useAppPrompts';

const Probe = ({ opts }: { opts: any }) => {
  const { handleGeneralAudit } = useAppPrompts(opts);
  return <button onClick={handleGeneralAudit}>auditar</button>;
};

const baseOpts = (over: any = {}) => ({
  activeTab: { projectPath: 'C:/proyectos/demo' },
  setProjectToast: vi.fn(),
  lang: 'es',
  tabs: { updateTab: vi.fn(), newTab: vi.fn() },
  onAuditStart: vi.fn(),
  currentSessionId: { current: '' },
  setPromptTitle: vi.fn(),
  setNonoStatus: vi.fn(),
  ...over,
});

describe('useAppPrompts · Auditoría General', () => {
  test('lanza la auditoría con el prompt del proyecto activo', () => {
    const opts = baseOpts();
    const { getByText } = render(<Probe opts={opts} />);

    fireEvent.click(getByText('auditar'));

    expect(opts.onAuditStart).toHaveBeenCalledTimes(1);
    const prompt = opts.onAuditStart.mock.calls[0][0] as string;
    expect(prompt).toContain('AUDITORÍA GENERAL');
    expect(prompt).toContain('C:/proyectos/demo');
    // Sin estas tools el modelo sólo puede inventarse los hallazgos.
    expect(prompt).toContain('read_diagnostics');
    expect(prompt).toContain('fs.grep');
  });

  test('sin proyecto seleccionado avisa y no arranca nada', () => {
    const opts = baseOpts({ activeTab: { projectPath: '' } });
    const { getByText } = render(<Probe opts={opts} />);

    fireEvent.click(getByText('auditar'));

    expect(opts.onAuditStart).not.toHaveBeenCalled();
    expect(opts.setProjectToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'err' })
    );
  });

  test('en alemán usa el prompt alemán', () => {
    const opts = baseOpts({ lang: 'de', activeTab: { projectPath: 'C:/x/demo' } });
    const { getByText } = render(<Probe opts={opts} />);

    fireEvent.click(getByText('auditar'));

    const prompt = opts.onAuditStart.mock.calls[0][0] as string;
    expect(prompt).toContain('ALLGEMEINE PRÜFUNG');
    expect(prompt).toContain('C:/x/demo');
  });
});
