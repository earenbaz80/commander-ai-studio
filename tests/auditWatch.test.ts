/**
 * El vigilante semanal decide con dos piezas que no necesitan red: cómo se
 * ordenan las versiones publicadas y qué advisories trae el JSON del audit.
 *
 * Si el orden fallara, `npm view` podría devolver un rango cuya versión más alta
 * no es la que se compara, y el aviso de «ya se puede parchear» llegaría tarde
 * o nunca. Si la deduplicación fallara, un mismo advisory contado veinte veces
 * parecería un cambio de situación.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  advisoriesDe,
  ARCHIVO_CIERRE,
  ARCHIVO_ISSUE,
  compararVersiones,
  cuerpoDeIssue,
  mayorVersion,
  PREAMBULO_CIERRE,
  publicarInforme,
  situacionResuelta,
  tituloDeIssue,
  yaEsAdoptable,
  type Encuentro,
  type Informe,
} from '../scripts/audit-watch.js';

test('las versiones se comparan por número, no como texto', () => {
  assert.ok(compararVersiones('10.10.0', '10.9.9') > 0, '10.10.0 es mayor que 10.9.9');
  assert.ok(compararVersiones('11.0.1', '10.99.0') > 0);
  assert.equal(compararVersiones('3.0.4', '3.0.4'), 0);
  assert.ok(compararVersiones('11.0.1', '11.0.1-beta.1') > 0, 'una beta no gana a la estable');
});

test('mayorVersion elige la más alta de una lista desordenada', () => {
  assert.equal(mayorVersion(['7.2.0', '7.10.2', '7.2.2']), '7.10.2');
  assert.equal(mayorVersion([]), undefined);
});

test('advisoriesDe deduplica por advisory y conserva paquete y severidad', () => {
  const advisories = advisoriesDe({
    vulnerabilities: {
      minimatch: {
        severity: 'moderate',
        via: [{ title: 'minimatch ReDoS', url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', severity: 'moderate' }],
      },
      'app-builder-lib': {
        severity: 'moderate',
        // Cadena que apunta al mismo advisory: no debe contarse dos veces.
        via: [
          { title: 'minimatch ReDoS', url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', severity: 'moderate' },
          'minimatch',
        ],
      },
    },
    metadata: { vulnerabilities: { moderate: 2, total: 2 } },
  });

  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].url, 'https://github.com/advisories/GHSA-g3hv-75wg-m249');
  assert.equal(advisories[0].severidad, 'moderate');
});

test('un advisory sin url también se reporta (con su título)', () => {
  const [advisory] = advisoriesDe({
    vulnerabilities: { foo: { via: [{ title: 'Fallo en foo' }] } },
  });
  assert.equal(advisory.titulo, 'Fallo en foo');
  assert.equal(advisory.url, undefined);
});

// --- Informe que el workflow publica como issue ---------------------------

const CONOCIDO = {
  paquete: 'minimatch',
  severidad: 'moderate',
  url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
  titulo: 'minimatch ReDoS',
};

const bloqueado: Encuentro = { desde: 'eslint@10.14.0', rango: '^10.2.6', resuelto: '10.2.10', parcheado: false };
const libre: Encuentro = { desde: 'glob@13.0.0', rango: '^11.0.1', resuelto: '11.0.1', parcheado: true };

function informeDe(parcial: Partial<Informe> = {}): Informe {
  return {
    advisories: [CONOCIDO],
    nuevos: [],
    totales: { moderate: 25 },
    encuentros: [bloqueado],
    fallos: 0,
    offline: false,
    ...parcial,
  };
}

const NUEVO = { paquete: 'tar', severidad: 'high', url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' };

test('el título nombra el disparador y conserva el ancla de búsqueda', () => {
  const porAdvisory = tituloDeIssue(informeDe({ nuevos: [NUEVO, { ...NUEVO, paquete: 'fjord' }] }));
  assert.match(porAdvisory, /^audit-watch:/, 'el prefijo es lo que busca `gh issue list`');
  assert.match(porAdvisory, /2 advisory\(s\) nuevo\(s\)/);

  const porCadena = tituloDeIssue(informeDe({ encuentros: [libre] }));
  assert.match(porCadena, /^audit-watch:/);
  assert.match(porCadena, /minimatch 11 ya es adoptable/);
});

test('el cuerpo trae las dos tablas y la acción cuando hay advisories nuevos', () => {
  const cuerpo = cuerpoDeIssue(informeDe({ nuevos: [NUEVO] }));

  assert.match(cuerpo, /## Cadena de ESLint y Electron/);
  assert.match(cuerpo, /\| `eslint@10\.14\.0` \| `\^10\.2\.6` \| 10\.2\.10 \| no \|/);
  assert.match(cuerpo, /## Advisories nuevos/);
  assert.match(cuerpo, /\| `tar` \| high \| https:\/\/github\.com\/advisories\/GHSA-xxxx-yyyy-zzzz \|/);
  assert.match(cuerpo, /- \[ \] Triar o parchear los \*\*1\*\* advisory\(s\) nuevo\(s\)/);
  assert.doesNotMatch(cuerpo, /Subir `eslint`/, 'la cadena sigue bloqueada: no se pide subir nada');
});

test('el cuerpo pide subir ESLint/Electron cuando la cadena ya es adoptable', () => {
  const cuerpo = cuerpoDeIssue(informeDe({ encuentros: [libre] }));
  assert.match(cuerpo, /- \[ \] Subir `eslint` \/ `electron-builder`/);
  assert.match(cuerpo, /\| `glob@13\.0\.0` \| `\^11\.0\.1` \| 11\.0\.1 \| sí \|/);
  assert.doesNotMatch(cuerpo, /## Advisories nuevos/, 'no hay ninguno: la tabla sobra');
});

test('el cuerpo en verde no pide trabajo: el resumen del step no puede mentir', () => {
  const cuerpo = cuerpoDeIssue(informeDe());
  assert.match(cuerpo, /## Estado/);
  assert.match(cuerpo, /Nada que hacer/);
  assert.doesNotMatch(cuerpo, /## Qué hacer/);
  assert.doesNotMatch(cuerpo, /- \[ \]/);
});

test('el cuerpo no afirma nada cuando no se pudo consultar el registry', () => {
  const cuerpo = cuerpoDeIssue(informeDe({ encuentros: [], fallos: 3, offline: true }));
  assert.match(cuerpo, /No consultada \(`--offline`\)/);
  assert.match(cuerpo, /ejecución con `--offline`/);

  const parcial = cuerpoDeIssue(informeDe({ fallos: 2 }));
  assert.match(parcial, /2 consulta\(s\) al registry no respondieron/);
});

test('una consulta fallida nunca cuenta como cadena adoptable', () => {
  assert.equal(yaEsAdoptable(informeDe({ encuentros: [libre] })), true);
  assert.equal(yaEsAdoptable(informeDe({ encuentros: [libre], fallos: 1 })), false);
  assert.equal(yaEsAdoptable(informeDe({ encuentros: [libre, bloqueado] })), false);
  assert.equal(yaEsAdoptable(informeDe({ encuentros: [] })), false, 'sin datos no hay veredicto');
});

test('publicarInforme deja los dos archivos que lee el workflow', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-watch-')), 'issue');
  process.env.AUDIT_WATCH_ISSUE_DIR = dir;
  try {
    publicarInforme('audit-watch: prueba', 'cuerpo del issue', { hayAccion: true, resuelta: false });
    assert.equal(fs.readFileSync(path.join(dir, ARCHIVO_ISSUE), 'utf8'), 'cuerpo del issue\n');
    assert.equal(fs.readFileSync(path.join(dir, 'issue.title'), 'utf8'), 'audit-watch: prueba\n');
    assert.equal(fs.existsSync(path.join(dir, ARCHIVO_CIERRE)), false, 'con acción no se cierra nada');

    // Sin acción no debe quedar el informe de la corrida anterior: el workflow
    // abriría un issue con datos viejos.
    publicarInforme('audit-watch: prueba', 'cuerpo del issue', { hayAccion: false, resuelta: false });
    assert.equal(fs.existsSync(dir), false);
  } finally {
    delete process.env.AUDIT_WATCH_ISSUE_DIR;
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

// --- Camino de vuelta: cerrar el issue cuando el aviso desaparece ----------

test('situacionResuelta pide cerrar sólo con veredicto completo y nada que hacer', () => {
  assert.equal(situacionResuelta(informeDe()), true, 'bloqueado, sin novedades: es la situación esperada');

  // Sin estas tres, el cierre llegaría con datos incompletos.
  assert.equal(situacionResuelta(informeDe({ fallos: 2 })), false, 'registry parcial: el aviso puede seguir vivo');
  assert.equal(situacionResuelta(informeDe({ encuentros: [] })), false, 'sin medir la cadena no hay veredicto');
  assert.equal(situacionResuelta(informeDe({ offline: true })), false, '`--offline` sólo mira el árbol instalado');

  // Y sin estas dos, cerraría con el motivo intacto.
  assert.equal(situacionResuelta(informeDe({ nuevos: [NUEVO] })), false, 'hay advisories nuevos');
  assert.equal(situacionResuelta(informeDe({ encuentros: [libre] })), false, 'la cadena ya es adoptable');
});

test('publicarInforme deja el cierre con su motivo, sin informe de issue', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-watch-')), 'issue');
  process.env.AUDIT_WATCH_ISSUE_DIR = dir;
  try {
    // Restos de una corrida roja en este mismo runner: no pueden sobrevivir.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ARCHIVO_ISSUE), 'viejo');

    publicarInforme('audit-watch: prueba', 'cuerpo del issue', { hayAccion: false, resuelta: true });
    assert.equal(fs.existsSync(path.join(dir, ARCHIVO_ISSUE)), false);
    assert.equal(fs.existsSync(path.join(dir, 'issue.title')), false);
    const cierre = fs.readFileSync(path.join(dir, ARCHIVO_CIERRE), 'utf8');
    assert.ok(cierre.startsWith(PREAMBULO_CIERRE), 'el issue se cierra diciendo por qué');
    assert.match(cierre, /cuerpo del issue/, 'lleva el informe de la corrida, no sólo el aviso');
  } finally {
    delete process.env.AUDIT_WATCH_ISSUE_DIR;
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});
