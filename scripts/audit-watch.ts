/**
 * Vigilante semanal del audit completo.
 *
 * El gate de CI sólo mira producción (`scripts/audit-prod.ts`) porque hay un
 * aviso de `minimatch` que hoy no se puede quitar sin romper el empaquetado de
 * Electron. El problema de un "ya lo arreglaremos" es que nadie se entera del
 * día en que sí se puede. Este script cierra ese hueco:
 *
 * 1. Corre `npm audit` completo. Cualquier advisory **nuevo** (que no sea el
 *    conocido) es accionable de inmediato.
 * 2. Recorre la cadena de ESLint y de Electron resolviendo los rangos de
 *    verdad contra el registry (`npm view <pkg>@<rango>`), en vez de adivinar
 *    con el lockfile instalado. Así detecta cuándo una versión publicada ya
 *    admite un `minimatch` parcheado.
 *
 * Sale 0 mientras la situación sea la esperada (bloqueado y sin novedades) y 1
 * cuando hay algo que hacer, para que el job programado avise. Con
 * `AUDIT_WATCH_ISSUE_DIR` deja el informe (`issue.md` + `issue.title`) para que
 * el workflow lo publique como issue; un fallo de red no lo deja, para no abrir
 * issues por un registry intermitente. En verde con veredicto completo deja
 * `cierre.md`, que es lo que usa el workflow para cerrar el issue abierto: el
 * camino de vuelta, no sólo el de aviso.
 *
 * Uso: `npx tsx scripts/audit-watch.ts` (opcional `--offline` para saltarse el
 * registry y mirar sólo el audit del árbol instalado).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** El advisory que motiva todo esto (ReDoS en minimatch por `globparts`). */
const ADVISORY_CONOCIDO = 'GHSA-g3hv-75wg-m249';
/** Primera versión con el arreglo: todo lo anterior es vulnerable. */
const PRIMERA_PARCHEADA = '11.0.1';

/** Aristas de la cadena que nos importan (no se recorre cualquier dependencia). */
const CADENA = new Set([
  'app-builder-lib',
  '@electron/asar',
  'dir-compare',
  'glob',
  'minimatch',
  '@eslint/eslintrc',
  '@eslint/config-array',
  '@typescript-eslint/typescript-estree',
  '@typescript-eslint/utils',
]);

/** Puntos de entrada: lo que el repo usa de ESLint y de Electron. */
const RAICES = [
  'eslint',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/typescript-estree',
  'electron-builder',
];

interface AuditJson {
  error?: { code?: string; summary?: string };
  message?: string;
  vulnerabilities?: Record<string, { severity?: string; via?: unknown[] }>;
  metadata?: { vulnerabilities?: Record<string, number> };
}

export interface Advisory {
  paquete: string;
  severidad: string;
  url?: string;
  titulo?: string;
}

export interface Encuentro {
  /** Paquete que declara la dependencia, p. ej. `eslint@10.14.0`. */
  desde: string;
  rango: string;
  /** Versión resuelta más alta que cumple el rango (o «?» si no se pudo). */
  resuelto: string;
  /** ¿Ese rango admite alguna versión >= 11.0.1? */
  parcheado: boolean;
}

/** Todo lo que necesita el informe que se publica como issue. */
export interface Informe {
  advisories: Advisory[];
  /** Los que no son el advisory conocido: esos son accionables ya. */
  nuevos: Advisory[];
  totales: Record<string, number>;
  encuentros: Encuentro[];
  /** Consultas al registry que no respondieron. */
  fallos: number;
  offline: boolean;
  ejecucion?: string;
}

/**
 * Compara versiones por partes numéricas (`10.10.0 > 10.9.9`) y, si el núcleo
 * coincide, deja ganar a la estable sobre una pre-release (`11.0.1 > 11.0.1-rc.1`).
 */
export function compararVersiones(a: string, b: string): number {
  const partir = (v: string) => {
    const [nucleo, ...resto] = v.split('-');
    return { numeros: nucleo.split('.').map(Number), pre: resto.join('-') };
  };
  const pa = partir(a);
  const pb = partir(b);
  for (let i = 0; i < Math.max(pa.numeros.length, pb.numeros.length); i++) {
    const d = (pa.numeros[i] ?? 0) - (pb.numeros[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre);
}

export function mayorVersion(versiones: string[]): string | undefined {
  return [...versiones].sort(compararVersiones).at(-1);
}

/** Advisories únicos del JSON de `npm audit`, deduplicados por url+título. */
export function advisoriesDe(datos: AuditJson): Advisory[] {
  const vistos = new Map<string, Advisory>();
  for (const [paquete, info] of Object.entries(datos.vulnerabilities ?? {})) {
    for (const via of Array.isArray(info?.via) ? info.via : []) {
      if (!via || typeof via !== 'object') continue;
      const { url, title, severity } = via as { url?: unknown; title?: unknown; severity?: unknown };
      if (typeof url !== 'string' && typeof title !== 'string') continue;
      const clave = `${String(url ?? '')}|${String(title ?? '')}`;
      if (vistos.has(clave)) continue;
      vistos.set(clave, {
        paquete,
        severidad: String(severity ?? info?.severity ?? 'unknown'),
        url: typeof url === 'string' ? url : undefined,
        titulo: typeof title === 'string' ? title : undefined,
      });
    }
  }
  return [...vistos.values()];
}

function entornoLimpio(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Heredado de `npm run`/`npx`; npm 12 lo rechaza en proyectos con `allowScripts`.
  for (const clave of Object.keys(env)) {
    if (/^npm_config_allow[_-]scripts$/i.test(clave)) delete env[clave];
  }
  return env;
}

/**
 * Los `npm view` fallan de vez en cuando por el registry (visto: salida 127 sin
 * mensaje). Se reintentan una vez; `npm audit` no, porque su código 1 es un
 * resultado válido (hay vulnerabilidades) y repetirlo sólo duplicaría el trabajo.
 */
function npm(
  args: string[],
  { timeoutMs = 60_000, intentos = 1 }: { timeoutMs?: number; intentos?: number } = {}
): { salida: string; error: string; status: number | null } {
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let ultimo: { salida: string; error: string; status: number | null } = { salida: '', error: '', status: null };
  for (let intento = 1; intento <= intentos; intento++) {
    const r = spawnSync(bin, args, {
      encoding: 'utf8',
      env: entornoLimpio(),
      shell: process.platform === 'win32',
      timeout: timeoutMs,
    });
    ultimo = { salida: r.stdout ?? '', error: r.stderr ?? '', status: r.status };
    if (ultimo.status === 0) return ultimo;
    if (intento < intentos) dormir(1000);
  }
  return ultimo;
}

function dormir(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `npm view` devuelve string si hay un solo valor y array si hay varios. */
function comoLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(comoLista);
  if (typeof valor === 'string' && valor.trim()) return [valor.trim()];
  return [];
}

/** Versiones publicadas que cumplen `rango`, según npm (no adivinamos semver). */
function versionesQueCumplen(paquete: string, rango: string): string[] {
  const r = npm(['view', `${paquete}@${rango}`, 'version', '--json'], { intentos: 2 });
  if (r.status !== 0) return [];
  try {
    return comoLista(JSON.parse(r.salida));
  } catch {
    return comoLista(r.salida.trim());
  }
}

/**
 * Versión más alta que cumple `rango` y sus dependencias, en **una** llamada.
 * `npm view` tarda segundos por invocación y esto recorre la cadena entera.
 */
function resolver(paquete: string, rango: string): { version: string; deps: Record<string, string> } | undefined {
  const r = npm(['view', `${paquete}@${rango}`, 'version', 'dependencies', '--json'], { intentos: 2 });
  if (r.status !== 0) return undefined;

  let datos: unknown;
  try {
    datos = JSON.parse(r.salida);
  } catch {
    return undefined;
  }

  const entradas = (Array.isArray(datos) ? datos : [datos]).filter(
    (e): e is { version?: unknown; dependencies?: unknown } => !!e && typeof e === 'object'
  );
  const elegida = entradas
    .map((e) => ({ version: String(e.version ?? ''), deps: e.dependencies }))
    .filter((e) => e.version)
    .sort((a, b) => compararVersiones(a.version, b.version))
    .at(-1);
  if (!elegida) return undefined;

  const deps = elegida.deps && typeof elegida.deps === 'object' ? (elegida.deps as Record<string, unknown>) : {};
  return {
    version: elegida.version,
    deps: Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, String(v)])),
  };
}

/** Recorre las cadenas conocidas y anota cada declaración de `minimatch`. */
export function encuentrosDeCadena(): { encuentros: Encuentro[]; fallos: number } {
  const encuentros: Encuentro[] = [];
  /** Consultas que no se pudieron resolver: un veredicto con ellas es parcial. */
  let fallos = 0;
  const visitados = new Set<string>();
  const cola: Array<{ nombre: string; rango: string }> = RAICES.map((nombre) => ({ nombre, rango: 'latest' }));

  while (cola.length > 0) {
    const { nombre, rango } = cola.shift()!;
    const nodo = resolver(nombre, rango);
    if (!nodo) {
      fallos++;
      continue;
    }
    const clave = `${nombre}@${nodo.version}`;
    if (visitados.has(clave)) continue;
    visitados.add(clave);

    if (nombre === 'minimatch') continue; // sus deps no importan
    const deps = nodo.deps;

    for (const [dep, rangoDep] of Object.entries(deps)) {
      if (dep === 'minimatch') {
        const versiones = versionesQueCumplen('minimatch', rangoDep);
        if (versiones.length === 0) fallos++;
        encuentros.push({
          desde: clave,
          rango: rangoDep,
          resuelto: mayorVersion(versiones) ?? '?',
          parcheado: versiones.some((v) => compararVersiones(v, PRIMERA_PARCHEADA) >= 0),
        });
        continue;
      }
      if (CADENA.has(dep)) cola.push({ nombre: dep, rango: rangoDep });
    }
  }

  return { encuentros, fallos };
}

/** Ancla del título: el workflow la busca para comentar en el issue ya abierto. */
export const PREFIJO_TITULO = 'audit-watch:';

/** ¿La cadena ya admite `minimatch >= 11.0.1` en todas sus declaraciones? */
export function yaEsAdoptable(informe: Pick<Informe, 'encuentros' | 'fallos'>): boolean {
  return informe.encuentros.length > 0 && informe.fallos === 0 && informe.encuentros.every((e) => e.parcheado);
}

/**
 * ¿La situación volvió a la esperada, con veredicto completo? Es la única
 * condición con la que el workflow cierra un issue abierto: sin registry
 * consultado (offline, todo caído o sólo parte resuelto) no se sabe si el
 * motivo del issue sigue vivo, y un fail-open lo cerraría por error.
 */
export function situacionResuelta(
  informe: Pick<Informe, 'nuevos' | 'encuentros' | 'fallos' | 'offline'>
): boolean {
  return (
    informe.nuevos.length === 0 &&
    !informe.offline &&
    informe.encuentros.length > 0 &&
    informe.fallos === 0 &&
    !yaEsAdoptable(informe)
  );
}

/** Nombra el disparador en el título: se entiende sin abrir el issue. */
export function tituloDeIssue(informe: Informe): string {
  const motivos: string[] = [];
  if (informe.nuevos.length > 0) motivos.push(`${informe.nuevos.length} advisory(s) nuevo(s)`);
  if (yaEsAdoptable(informe)) motivos.push('minimatch 11 ya es adoptable');
  return `${PREFIJO_TITULO} ${motivos.join(' y ') || 'audit completo pendiente'}`;
}

/**
 * Cuerpo del issue y, a la vez, resumen del step: un solo formato para que lo
 * que se lee en el log y lo que queda en el issue no puedan divergir.
 */
export function cuerpoDeIssue(informe: Informe): string {
  const { advisories, nuevos, totales, encuentros, fallos, offline } = informe;
  const bloqueados = encuentros.filter((e) => !e.parcheado);
  const adoptable = yaEsAdoptable(informe);
  const lineas: string[] = [
    'El gate de cada PR audita sólo dependencias de producción porque el aviso de ' +
      '`minimatch` ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) ' +
      'no se puede quitar sin romper el empaquetado de Electron. Este informe lo genera el job ' +
      'programado *Audit watch*, que abre un issue cuando ese supuesto deja de valer.',
    '',
  ];

  if (nuevos.length > 0 || adoptable) {
    lineas.push('## Qué hacer', '');
    if (nuevos.length > 0) {
      lineas.push(
        `- [ ] Triar o parchear los **${nuevos.length}** advisory(s) nuevo(s): no son el ReDoS conocido, ` +
          'así que el bloqueo de `minimatch` no los justifica.'
      );
    }
    if (adoptable) {
      lineas.push(
        '- [ ] Subir `eslint` / `electron-builder` a versiones que resuelvan `minimatch >= 11.0.1`, ' +
          'devolver `npm audit` completo al gate del CI y quitar el punto pendiente del README.'
      );
    }
  } else {
    // Mismo texto para el resumen del step: en verde no puede pedir trabajo.
    lineas.push('## Estado', '');
    lineas.push(
      encuentros.length === 0
        ? offline
          ? 'No se consultó la cadena: ejecución con `--offline`, sólo el árbol instalado.'
          : 'Sin veredicto: no se pudo resolver la cadena contra el registry.'
        : 'Nada que hacer: sin advisories nuevos y la cadena sigue sin admitir `minimatch >= 11.0.1`.'
    );
  }

  lineas.push(
    '',
    '## Resumen',
    '',
    `- advisories únicos: **${advisories.length}** (nuevos: **${nuevos.length}**)`,
    `- declaraciones de \`minimatch\` en la cadena: **${encuentros.length}** · sin parchear: **${bloqueados.length}**`
  );
  const porSeveridad = Object.entries(totales).filter(([, n]) => n > 0);
  if (porSeveridad.length > 0) {
    lineas.push(`- audit completo: ${porSeveridad.map(([sev, n]) => `${sev} ${n}`).join(', ')}`);
  }
  if (fallos > 0) {
    lineas.push(`- **${fallos} consulta(s) al registry no respondieron**: el veredicto puede estar incompleto.`);
  }
  if (offline) {
    lineas.push('- ejecución con `--offline`: no se consultó el registry, sólo el árbol instalado.');
  }

  lineas.push('', '## Cadena de ESLint y Electron', '');
  if (encuentros.length === 0) {
    lineas.push(offline ? '_No consultada (`--offline`)._' : '_No se pudo resolver ninguna declaración._');
  } else {
    lineas.push(
      '| desde | rango | resuelve | ≥11.0.1 |',
      '| --- | --- | --- | --- |',
      ...encuentros.map((e) => `| \`${e.desde}\` | \`${e.rango}\` | ${e.resuelto} | ${e.parcheado ? 'sí' : 'no'} |`)
    );
  }

  if (nuevos.length > 0) {
    lineas.push(
      '',
      '## Advisories nuevos',
      '',
      '| paquete | severidad | advisory |',
      '| --- | --- | --- |',
      ...nuevos.map((a) => `| \`${a.paquete}\` | ${a.severidad} | ${a.url ?? a.titulo ?? 'sin referencia'} |`)
    );
  }

  if (informe.ejecucion) lineas.push('', `Corrida: ${informe.ejecucion}`);
  lineas.push('', '_Informe generado por `scripts/audit-watch.ts`._');
  return lineas.join('\n');
}

/** Archivos que deja el informe: el workflow los busca por nombre. */
export const ARCHIVO_ISSUE = 'issue.md';
export const ARCHIVO_CIERRE = 'cierre.md';

/** Encabezado del comentario de cierre: el issue no se cierra en silencio. */
export const PREAMBULO_CIERRE =
  '> Cerrado automáticamente: esta corrida del vigilante no encontró nada que hacer, ' +
  'así que el motivo de este issue ya no se reproduce. Si vuelve a darse, se abre otro.';

/**
 * Deja el informe donde el workflow lo recoge (`AUDIT_WATCH_ISSUE_DIR`). Sin la
 * variable no escribe nada: en local el job se lee por consola.
 *
 * - con acción: `issue.md` + `issue.title` (abrir o comentar);
 * - sin acción y veredicto completo: `cierre.md` (comentar y cerrar);
 * - sin veredicto (offline, registry parcial, todo caído): no deja nada, y
 *   borra los restos de una corrida anterior para que el workflow no publique
 *   datos viejos de este mismo runner.
 */
export function publicarInforme(
  titulo: string,
  cuerpo: string,
  { hayAccion, resuelta }: { hayAccion: boolean; resuelta: boolean }
): void {
  const dir = process.env.AUDIT_WATCH_ISSUE_DIR;
  if (!dir) return;
  try {
    // Una sola foto por corrida: nunca conviene mezclar un issue con un cierre.
    fs.rmSync(dir, { recursive: true, force: true });
    if (hayAccion) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ARCHIVO_ISSUE), cuerpo + '\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'issue.title'), titulo + '\n', 'utf8');
      console.log(`[watch] informe para el issue en ${dir}`);
      return;
    }
    if (resuelta) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ARCHIVO_CIERRE), `${PREAMBULO_CIERRE}\n\n${cuerpo}\n`, 'utf8');
      console.log(`[watch] informe de cierre (issue abierto, si lo hay) en ${dir}`);
    }
  } catch (e) {
    // Sin informe el workflow no abre issue: que quede en el log, no en silencio.
    console.error(`[watch] no se pudo escribir el informe: ${(e as Error).message}`);
  }
}

function urlDeEjecucion(): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function resumirEnGithub(markdown: string) {
  const destino = process.env.GITHUB_STEP_SUMMARY;
  if (!destino) return;
  try {
    fs.appendFileSync(destino, markdown + '\n');
  } catch {
    /* el resumen es un extra: si falla, el job ya tiene la salida */
  }
}

function avisar(mensaje: string) {
  // Anotación de GitHub Actions: queda visible aunque el job termine en verde.
  console.log(`::warning title=Audit completo::${mensaje}`);
  console.warn(`[watch] ${mensaje}`);
}

function main() {
  const offline = process.argv.includes('--offline');

  const audit = npm(['audit', '--json'], { timeoutMs: 120_000 });
  let datos: AuditJson;
  try {
    datos = JSON.parse(audit.salida) as AuditJson;
  } catch {
    console.error(`[watch] no se pudo leer el audit: ${(audit.error || audit.salida).trim().slice(0, 300)}`);
    process.exit(1);
  }
  if (datos.error || datos.message) {
    // En un job programado no reintentamos: mañana vuelve a correr.
    console.error(`[watch] npm audit falló: ${datos.message ?? datos.error?.summary ?? 'sin detalle'}`);
    process.exit(1);
  }

  const advisories = advisoriesDe(datos);
  const nuevos = advisories.filter((a) => !(a.url ?? '').includes(ADVISORY_CONOCIDO));
  const totales = datos.metadata?.vulnerabilities ?? {};

  console.log('[watch] audit completo:');
  for (const [sev, n] of Object.entries(totales)) {
    if (n > 0) console.log(`  ${sev}: ${n}`);
  }
  console.log(`  advisories únicos: ${advisories.length} (nuevos: ${nuevos.length})`);

  if (nuevos.length > 0) {
    console.error('[watch] advisories NUEVOS (no son el conocido de minimatch):');
    for (const a of nuevos) {
      console.error(`  ${a.severidad.padEnd(8)} ${a.paquete}  ${a.url ?? a.titulo ?? 'sin referencia'}`);
    }
    avisar(`${nuevos.length} advisory(s) nuevo(s) en dependencias de desarrollo`);
  }

  let encuentros: Encuentro[] = [];
  let fallos = 0;
  if (!offline) {
    console.log('\n[watch] cadena de ESLint/Electron contra el registry:');
    ({ encuentros, fallos } = encuentrosDeCadena());
    for (const e of encuentros) {
      console.log(`  ${e.parcheado ? '✓' : '✗'} ${e.desde} → minimatch ${e.rango} (resuelve ${e.resuelto})`);
    }
    if (encuentros.length === 0) {
      avisar('no se pudo resolver ninguna dependencia de la cadena: revisa la conexión con el registry');
    } else if (fallos > 0) {
      // Un registry intermitente no debe inventar un veredicto: se avisa, pero
      // sin afirmar que ya se puede parchear.
      avisar(`${fallos} consulta(s) al registry no respondieron; el veredicto puede estar incompleto`);
    }
  }

  const informe: Informe = { advisories, nuevos, totales, encuentros, fallos, offline, ejecucion: urlDeEjecucion() };
  const adoptable = yaEsAdoptable(informe);
  const bloqueados = encuentros.filter((e) => !e.parcheado);
  /** Algo que una persona debe hacer: lo único que justifica abrir un issue. */
  const hayAccion = nuevos.length > 0 || adoptable;
  /** No se pudo medir la cadena: falla (no hay veredicto), pero no es accionable. */
  const indeterminado = !offline && encuentros.length === 0;

  if (adoptable) {
    console.error(
      '\n[watch] ACCIÓN: toda la cadena ya admite minimatch >= 11.0.1. ' +
        'Se puede subir el gate a `npm audit` completo: actualiza ESLint/Electron y quita el punto pendiente del README.'
    );
    avisar('la cadena de ESLint/Electron ya admite minimatch parcheado: se puede limpiar el audit completo');
  } else if (bloqueados.length > 0) {
    console.log(`\n[watch] sigue bloqueado por ${bloqueados.length} rango(s); nada que hacer todavía.`);
  }

  // Mismo texto para el resumen del step y para el issue: no pueden divergir.
  const cuerpo = cuerpoDeIssue(informe);
  resumirEnGithub(cuerpo);
  publicarInforme(tituloDeIssue(informe), cuerpo, { hayAccion, resuelta: situacionResuelta(informe) });

  if (hayAccion) {
    console.error('\n[watch] hay algo que hacer: revisa los avisos de arriba.');
    process.exit(1);
  }
  if (indeterminado) process.exit(1);
  console.log('\n[watch] situación esperada: audit completo bloqueado sólo por el aviso conocido de minimatch.');
}

// Importable desde tests sin ejecutar la vigilancia.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
