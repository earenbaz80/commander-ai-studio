/**
 * Regresión del bucle de arranque del BIOS.
 *
 * App renderiza `<RetroBiosBoot onComplete={() => setIsBooting(false)} />`, así
 * que la prop cambia de identidad en cada render. Con `onComplete` en las deps
 * del efecto, cada re-render reiniciaba la secuencia a 0% y borraba el failsafe:
 * la app se quedaba clavada en la pantalla de BIOS. El efecto usa una ref y sólo
 * depende de `lang`, así que el arranque termina aunque el padre re-renderice.
 */
import { useEffect, useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetroBiosBoot } from '../../src/components/RetroBiosBoot';

/** Padre que se re-renderiza cada 100 ms, como la app real con sus sondeos. */
function Harness() {
  const [booting, setBooting] = useState(true);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  return booting
    ? <RetroBiosBoot onComplete={() => setBooting(false)} lang="es" />
    : <div>ESTUDIO LISTO</div>;
}

describe('RetroBiosBoot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('termina aunque el padre re-renderice con un onComplete nuevo en cada render', () => {
    render(<Harness />);
    expect(screen.getByText(/COMMANDER AI SYSTEMS INC\./)).toBeTruthy();

    // 5 s de reloj con un re-render cada 100 ms: con el bug, cada re-render
    // reiniciaba la secuencia y el failsafe no llegaba a dispararse nunca.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('ESTUDIO LISTO')).toBeTruthy();
  });
});
