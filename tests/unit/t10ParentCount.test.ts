import { describe, expect, it } from 'vitest';
import { confirmsTwoChildren } from '../../evals/scenarios';

/**
 * Respuesta literal del padre en T10-3 de `G1-T10-13`: el regex anterior
 * (`/2|dos/`) la daba por buena porque contiene «dos tandas seguidas».
 */
const CIERRE_POR_RACHA =
  'No completé la tarea: hubo subagentes fallidos en dos tandas seguidas. Motivo: El proveedor devolvió turnos vacíos: el subagente no produjo respuesta ni llamadas.';

describe('contador de hijos del padre de T10', () => {
  it('acepta una cuenta explícita de dos hijos', () => {
    expect(confirmsTwoChildren('2')).toBe(true);
    expect(confirmsTwoChildren('2 children finished.')).toBe(true);
    expect(confirmsTwoChildren('Terminaron dos hijos.')).toBe(true);
    expect(confirmsTwoChildren('Total de subagentes: dos.')).toBe(true);
  });

  it('acepta el cierre medido de T10-4 con el contador al final', () => {
    // Respuesta literal de G1-T10-14: el número viene detrás de la etiqueta y
    // envuelto en énfasis Markdown; el regex anterior la rechazaba.
    expect(
      confirmsTwoChildren('El objetivo T10 ha finalizado. **Total de hijos que terminaron: 2**.')
    ).toBe(true);
  });

  it('no acepta el cierre por racha de T10-3', () => {
    expect(confirmsTwoChildren(CIERRE_POR_RACHA)).toBe(false);
  });

  it('rechaza respuestas sin la cuenta', () => {
    expect(confirmsTwoChildren('1')).toBe(false);
    expect(confirmsTwoChildren('')).toBe(false);
    expect(confirmsTwoChildren(undefined)).toBe(false);
    expect(confirmsTwoChildren('Terminaron 2 pasos.')).toBe(false);
    expect(confirmsTwoChildren('Total de pasos: 2')).toBe(false);
  });
});
