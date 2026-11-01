/**
 * Gate de auditoría de dependencias de producción para CI.
 *
 * `npm audit --omit=dev` sale con código 1 en dos casos que el workflow no
 * puede distinguir: hay vulnerabilidades, o el registry no respondió. Fallar
 * siempre convierte un reset de red en un PR rojo; reintentar siempre esconde
 * avisos reales. Por eso aquí se lee el JSON de npm:
 *
 * - `error.code` de transporte (`EAI_AGAIN`, `ETIMEDOUT`, 5xx del registry…) →
 *   se reintenta **una** vez.
 * - `vulnerabilities` con paquetes → es un resultado de verdad: se reporta y se
 *   sale 1 sin reintentar ni relajar el umbral.
 * - Cualquier otra cosa (JSON ilegible, npm roto) → se falla enseguida, sin
 *   reintento, porque no es red y reintentarlo sólo retrasa el diagnóstico.
 *
 * Uso: `npx tsx scripts/audit-prod.ts`
 * Sale 0 si producción está limpia; 1 si hay avisos o si el segundo intento
 * tampoco alcanza el registry.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Un reintento: cubre el corte puntual sin alargar el job si el registry está caído. */
const INTENTOS = 2;
const ESPERA_REINTENTO_MS = 3000;

/** Códigos concretos de transporte, para nombrar el fallo sin repetir el mensaje entero. */
const CODIGO_DE_RED = /(EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ERR_SOCKET_TIMEOUT|FETCH_ERROR|E50[0234])/i;

/** Códigos y mensajes que significan «no llegué al registry», no «el árbol es vulnerable». */
const SENAL_DE_RED =
  /\b(EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ERR_SOCKET_TIMEOUT|FETCH_ERROR|E50[0234])\b|socket hang up|request to .* failed|network (error|request|timeout)/i;

const ORDEN_SEVERIDAD = ['critical', 'high', 'moderate', 'low', 'info'] as const;
type Severidad = (typeof ORDEN_SEVERIDAD)[number];

interface AuditJson {
  error?: { code?: string; summary?: string; detail?: string };
  /** npm pone aquí el fallo de transporte cuando el registry no responde. */
  message?: string;
  metadata?: { vulnerabilities?: Record<string, number> };
  vulnerabilities?: Record<string, { severity?: string; via?: unknown[] }>;
}

export type Clasificacion =
  | { tipo: 'limpio' }
  | { tipo: 'vulnerable'; paquetes: Array<{ nombre: string; severidad: string; aviso?: string }>; total: number }
  | { tipo: 'red'; codigo: string; detalle: string }
  | { tipo: 'desconocido'; detalle: string };

function primerAviso(via: unknown): string | undefined {
  if (!Array.isArray(via)) return undefined;
  for (const entrada of via) {
    if (entrada && typeof entrada === 'object') {
      const titulo = (entrada as { title?: unknown }).title;
      const url = (entrada as { url?: unknown }).url;
      if (typeof titulo === 'string') return typeof url === 'string' ? `${titulo} (${url})` : titulo;
    }
  }
  return undefined;
}

/**
 * Traduce la salida de `npm audit` a una decisión. Puro: se puede probar sin red.
 * `error` es el stderr del proceso: npm deja ahí la señal de red cuando el JSON
 * sólo trae `message`.
 */
export function clasificar(salida: string, error = ''): Clasificacion {
  let datos: AuditJson;
  try {
    datos = JSON.parse(salida) as AuditJson;
  } catch {
    const pista = (salida + '\n' + error).trim().split('\n').slice(-3).join(' ').slice(0, 300);
    if (SENAL_DE_RED.test(pista)) {
      return { tipo: 'red', codigo: pista.match(CODIGO_DE_RED)?.[1] ?? 'transporte', detalle: pista };
    }
    return { tipo: 'desconocido', detalle: pista || 'salida vacía' };
  }

  if (datos.error || datos.message) {
    // Nunca hay vulnerabilidades en este JSON: npm abortó antes de leer el árbol.
    const codigo = String(datos.error?.code ?? '');
    const detalle =
      [datos.message, datos.error?.detail, datos.error?.summary].map((x) => (x ?? '').trim()).find(Boolean) ??
      error.trim().split('\n').slice(-3).join(' ');
    const texto = [codigo, datos.message ?? '', error].join(' ');
    if (SENAL_DE_RED.test(texto)) {
      const etiqueta = codigo || texto.match(CODIGO_DE_RED)?.[1] || 'transporte';
      return { tipo: 'red', codigo: etiqueta, detalle: detalle || 'fallo de transporte' };
    }
    return { tipo: 'desconocido', detalle: `${codigo || 'sin código'}: ${detalle || 'error sin detalle'}` };
  }

  const totales = datos.metadata?.vulnerabilities ?? {};
  const total = ORDEN_SEVERIDAD.reduce((suma, sev) => suma + (totales[sev] ?? 0), 0);

  const paquetes = Object.entries(datos.vulnerabilities ?? {})
    .map(([nombre, info]) => ({
      nombre,
      severidad: String(info?.severity ?? 'unknown'),
      aviso: primerAviso(info?.via),
    }))
    .sort(
      (a, b) =>
        ORDEN_SEVERIDAD.indexOf(a.severidad as Severidad) - ORDEN_SEVERIDAD.indexOf(b.severidad as Severidad) ||
        a.nombre.localeCompare(b.nombre)
    );

  // Un aviso puede venir en `vulnerabilities` sin sumar en `metadata` (o al revés):
  // cualquiera de los dos es motivo suficiente para no dar el gate por bueno.
  if (total > 0 || paquetes.length > 0) return { tipo: 'vulnerable', paquetes, total: Math.max(total, paquetes.length) };
  return { tipo: 'limpio' };
}

function dormir(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ejecutarAudit(): { salida: string; error: string; status: number | null; fallo?: string } {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = { ...process.env };
  // `npm run`/`npx` exportan su config como variables de entorno. Si el usuario
  // tiene `allow-scripts = true` en su .npmrc, el npm hijo la recibe como si
  // fuera un flag y npm 12 la rechaza en proyectos con campo `allowScripts`
  // (EALLOWSCRIPTS), sin llegar a auditar. No la pide este script.
  for (const clave of Object.keys(env)) {
    if (/^npm_config_allow[_-]scripts$/i.test(clave)) delete env[clave];
  }
  const r = spawnSync(npm, ['audit', '--omit=dev', '--audit-level=low', '--json'], {
    encoding: 'utf8',
    env,
    // En Windows npm es un .cmd: sin shell, Node 22+ se niega a ejecutarlo.
    shell: process.platform === 'win32',
  });
  if (r.error) return { salida: r.stdout ?? '', error: r.stderr ?? '', status: r.status, fallo: r.error.message };
  return { salida: r.stdout ?? '', error: r.stderr ?? '', status: r.status };
}

function reportarFallos(paquetes: Array<{ nombre: string; severidad: string; aviso?: string }>) {
  for (const p of paquetes) {
    console.error(`  ${p.severidad.padEnd(8)} ${p.nombre}${p.aviso ? `  ${p.aviso}` : ''}`);
  }
}

export function main() {
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const r = ejecutarAudit();
    if (r.fallo) {
      console.error(`[audit] no se pudo ejecutar npm audit: ${r.fallo}`);
      process.exit(1);
    }

    const resultado = clasificar(r.salida, r.error);

    if (resultado.tipo === 'limpio') {
      console.log('[audit] producción limpia: 0 vulnerabilidades en dependencias de producción');
      process.exit(0);
    }

    if (resultado.tipo === 'vulnerable') {
      // Sin reintento y sin tocar el umbral: es el caso que el gate existe para atrapar.
      console.error(`[audit] ${resultado.total} vulnerabilidad(es) en producción:`);
      reportarFallos(resultado.paquetes);
      console.error('[audit] esto no se reintenta: son dependencias que se empaquetan.');
      process.exit(1);
    }

    if (resultado.tipo === 'red' && intento < INTENTOS) {
      console.warn(
        `[audit] intento ${intento}/${INTENTOS}: error de red (${resultado.codigo}: ${resultado.detalle}); ` +
          `reintento en ${ESPERA_REINTENTO_MS / 1000}s`
      );
      dormir(ESPERA_REINTENTO_MS);
      continue;
    }

    if (resultado.tipo === 'red') {
      console.error(
        `[audit] el registry no respondió en ${INTENTOS} intentos (${resultado.codigo}: ${resultado.detalle}). ` +
          'No es un veredicto sobre las dependencias: vuelve a lanzar el job.'
      );
      process.exit(1);
    }

    console.error(`[audit] no se pudo interpretar la salida de npm audit (${resultado.detalle})`);
    if (r.error.trim()) console.error(r.error.trim().split('\n').slice(-5).join('\n'));
    process.exit(1);
  }
}

// Importable desde tests: sólo actúa cuando se ejecuta como script.
const ejecutadoDirectamente =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ejecutadoDirectamente) main();
