import { describe, expect, it } from 'vitest';
import {
  commandFor,
  detectProjectLanguages,
  parseCargoJson,
  parseGoVet,
  parseLanguageOutput,
  parsePyrightJson,
} from '../../languageDiagnostics';

describe('detección de lenguaje', () => {
  it('reconoce python, go y rust por sus marcadores', () => {
    expect(detectProjectLanguages(['pyproject.toml', 'src/app.py'])).toEqual(['python']);
    expect(detectProjectLanguages(['go.mod', 'main.go'])).toEqual(['go']);
    expect(detectProjectLanguages(['Cargo.toml'])).toEqual(['rust']);
    expect(detectProjectLanguages(['tsconfig.json', 'package.json'])).toEqual([]);
    expect(detectProjectLanguages(['pyproject.toml', 'go.mod', 'Cargo.toml'])).toEqual([
      'python',
      'go',
      'rust',
    ]);
  });

  it('elige el comando de cada lenguaje', () => {
    expect(commandFor('python')).toEqual({ command: 'pyright', args: ['--outputjson'] });
    expect(commandFor('go')).toEqual({ command: 'go', args: ['vet', './...'] });
    expect(commandFor('rust').command).toBe('cargo');
  });
});

describe('parsers', () => {
  it('pyright: pasa de 0-based a 1-based y separa severidad', () => {
    const raw = JSON.stringify({
      generalDiagnostics: [
        {
          file: '/proj/app.py',
          severity: 'error',
          message: 'Undefined name "x"',
          rule: 'reportUndefinedVariable',
          range: { start: { line: 9, character: 4 } },
        },
        { file: '/proj/app.py', severity: 'warning', message: 'Unused import', range: { start: { line: 0, character: 0 } } },
      ],
    });
    expect(parsePyrightJson(raw)).toEqual([
      { file: '/proj/app.py', line: 10, column: 5, severity: 'error', code: 'reportUndefinedVariable', message: 'Undefined name "x"' },
      { file: '/proj/app.py', line: 1, column: 1, severity: 'warning', code: '', message: 'Unused import' },
    ]);
  });

  it('pyright: salida inválida no rompe', () => {
    expect(parsePyrightJson('no es json')).toEqual([]);
    expect(parsePyrightJson('')).toEqual([]);
  });

  it('cargo: sólo lee compiler-message y usa el primer span', () => {
    const raw = [
      JSON.stringify({ reason: 'compiler-artifact', target: { name: 'x' } }),
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          level: 'error',
          message: 'cannot find value `y`',
          code: { code: 'E0425' },
          spans: [{ file_name: 'src/main.rs', line_start: 3, column_start: 5 }],
        },
      }),
      'basura',
    ].join('\n');
    expect(parseCargoJson(raw)).toEqual([
      { file: 'src/main.rs', line: 3, column: 5, severity: 'error', code: 'E0425', message: 'cannot find value `y`' },
    ]);
  });

  it('go vet: parsea archivo:línea:columna', () => {
    const raw = '# acme/app\n./main.go:10:2: undefined: foo\n./pkg/x.go:1:1: something\nsugerencia: ...';
    expect(parseGoVet(raw)).toEqual([
      { file: './main.go', line: 10, column: 2, severity: 'error', code: '', message: 'undefined: foo' },
      { file: './pkg/x.go', line: 1, column: 1, severity: 'error', code: '', message: 'something' },
    ]);
  });

  it('parseLanguageOutput enruta cada lenguaje', () => {
    expect(parseLanguageOutput('go', 'a.go:1:2: m')).toHaveLength(1);
    expect(parseLanguageOutput('rust', '')).toEqual([]);
    expect(parseLanguageOutput('python', '{}')).toEqual([]);
  });
});
