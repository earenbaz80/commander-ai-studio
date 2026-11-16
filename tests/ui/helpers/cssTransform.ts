/**
 * Lectura de `transform` tolerante a la serialización de jsdom.
 *
 * jsdom 26 y 31 no escriben igual el CSSOM: el motor nuevo normaliza ceros
 * (`0` → `0px`) y omite los ejes que valen cero (`translate(0px, 0px)` queda
 * como `translate(0px)`). Los tests comparan la geometría en píxeles, no el
 * texto exacto que devuelve el navegador.
 */

type Offset = { x: number; y: number; z: number };

/** Desplazamiento en px de la última `translate()` o `translate3d()` del transform. */
export function translatePx(transform: string): Offset {
  const matches = [...transform.matchAll(/(?:^|\s)translate(?:3d)?\(\s*([^)]*)\)/g)];
  const last = matches.at(-1);
  if (!last) throw new Error(`El transform no tiene translate(): "${transform}"`);
  const [x = 0, y = 0, z = 0] = last[1].split(',').map((part) => Number.parseFloat(part));
  return { x, y, z };
}
