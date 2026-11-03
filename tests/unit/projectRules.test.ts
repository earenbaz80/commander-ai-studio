import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { checkSource, newViolations } from '../../src/agent/projectRules';

/**
 * Las dos reglas propias del repo.
 *
 * Lo que se prueba no es «detecta colores» sino las dos cosas que hacen que la
 * regla sirva: no marca lo que ya está bien (una llamada al traductor, un
 * `className`, un comentario) y `newViolations` distingue la deuda previa de lo
 * que añade un cambio, que es lo único accionable.
 */

const check = (file: string, text: string) => checkSource(ts, file, text);

describe('color-token', () => {
  it('marca un color literal dentro de una cadena', () => {
    const v = check('src/components/X.tsx', "export const X = () => <div style={{ color: '#ff0000' }} />;\n");
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('color-token');
    expect(v[0].excerpt).toBe('#ff0000');
    expect(v[0].line).toBe(1);
  });

  it('no marca un color dentro de un comentario', () => {
    expect(check('src/a.ts', '// el azul Norton es #000080\nexport const a = 1;\n')).toEqual([]);
  });

  it('ignora archivos que no son TypeScript', () => {
    expect(check('styles.css', ':root { --azul: #000080; }')).toEqual([]);
  });
});

describe('i18n-literal', () => {
  it('marca texto JSX que no pasa por el traductor', () => {
    const v = check('src/components/X.tsx', 'export const X = () => <p>Buscar en el manual</p>;\n');
    expect(v.map((x) => x.rule)).toEqual(['i18n-literal']);
    expect(v[0].excerpt).toBe('Buscar en el manual');
  });

  it('no marca el texto que sí pasa por L(...)', () => {
    expect(check('src/components/X.tsx', "export const X = () => <p>{L('Buscar en el manual', 'Search the manual')}</p>;\n")).toEqual([]);
  });

  it('marca un placeholder sin traducir pero no un className', () => {
    const v = check(
      'src/components/X.tsx',
      'export const X = () => <input className="btn btn-primary" placeholder="Escribe tu tarea aquí" />;\n'
    );
    expect(v).toHaveLength(1);
    expect(v[0].excerpt).toBe('Escribe tu tarea aquí');
  });

  it('no marca identificadores ni clases', () => {
    expect(check('src/components/X.tsx', "export const X = () => <div className='panel-retro-norton' />;\n")).toEqual([]);
  });
});

describe('newViolations', () => {
  const antes = check('src/components/X.tsx', "export const A = () => <p style={{ color: '#ff0000' }}>Hola mundo</p>;\n");

  it('un contenido idéntico no añade nada', () => {
    const despues = check('src/components/X.tsx', "export const A = () => <p style={{ color: '#ff0000' }}>Hola mundo</p>;\n");
    expect(newViolations(antes, despues)).toEqual([]);
  });

  it('sólo cuenta lo que el cambio introduce', () => {
    const despues = check(
      'src/components/X.tsx',
      "export const A = () => <p style={{ color: '#ff0000' }}>Hola mundo</p>;\nexport const B = () => <p style={{ color: '#00ff00' }}>Otra cosa</p>;\n"
    );
    // El rojo ya estaba; el verde y el texto nuevo no.
    expect(newViolations(antes, despues).map((v) => v.excerpt)).toEqual(['#00ff00', 'Otra cosa']);
  });

  it('quitar deuda no cuenta como violación', () => {
    const despues = check('src/components/X.tsx', "export const A = () => <p>Hola mundo</p>;\n");
    expect(newViolations(antes, despues)).toEqual([]);
  });
});
