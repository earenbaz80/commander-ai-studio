import { describe, it, expect } from 'vitest';
import { closingContractAnswer } from '../../evals/scenarios';

/**
 * T10 exigía `/listo/` en la respuesta de cada hijo, pero el contrato de cierre
 * pide `Archivos:` y `Denegado:`. Dos corridas reales con ambos hijos
 * completados fallaron sólo por esa palabra que ningún prompt pide.
 */
describe('contrato de cierre de los hijos de T10', () => {
  it('acepta el cierre real, con Archivos y Denegado en cualquier caja', () => {
    expect(
      closingContractAnswer(
        'Archivos: hijo-a.txt\nDenegado: shell.run: Tool denegada por la configuración de permisos.'
      )
    ).toBe(true);
    expect(closingContractAnswer('ARCHIVOS: ninguno\nDENEGADO: shell.run: Tool denegada')).toBe(true);
    expect(closingContractAnswer('ARCHIVOS: hijo-b.txt\nDenegada: ninguna')).toBe(true);
  });

  it('no acepta «listo» ni un cierre a medias', () => {
    expect(closingContractAnswer('Hijo A listo.')).toBe(false);
    expect(closingContractAnswer('Archivos: hijo-a.txt')).toBe(false);
    expect(closingContractAnswer('Denegado: ninguna')).toBe(false);
    expect(closingContractAnswer('Objetivo completado.')).toBe(false);
    expect(closingContractAnswer('')).toBe(false);
    expect(closingContractAnswer(undefined)).toBe(false);
  });
});
