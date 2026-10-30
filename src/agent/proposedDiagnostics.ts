/**
 * Typecheck de un contenido propuesto, sin escribirlo.
 *
 * `fs.propose.*` devuelve un diff, y un diff dice qué cambia, no si compila. La
 * forma obvia de comprobarlo —escribir el archivo, lanzar `tsc` y borrarlo— es
 * justo lo que estas tools prometen no hacer: un fallo en medio dejaría el repo
 * sucio y el archivo "propuesto" pasaría a existir para el usuario, para el
 * índice y para los hooks. Así que se construye un `Program` de TypeScript con
 * un host que devuelve el texto propuesto para esa ruta y lee el resto del
 * disco: el archivo nunca llega a existir.
 *
 * Sólo se compila ese archivo como raíz. Sus imports se resuelven con el
 * `tsconfig.json` del proyecto, así que el resultado es el del proyecto real; lo
 * que no toca no se revisa, que es lo que interesa aquí (los errores ajenos ya
 * estaban antes del cambio).
 *
 * Es síncrono y bloquea el event loop: por eso es opt-in (`diagnose: true`) y
 * no se ejecuta en cada propuesta. Para que ese bloqueo sea corto, los
 * `SourceFile` ya parseados se reutilizan (incluidos los `.d.ts` de
 * `node_modules`, que son la mitad del coste) y se invalidan por `mtime`/tamaño:
 * un archivo que cambió en disco se vuelve a leer. Medido en este repo: ~1,3 s
 * en frío y ~90 ms en caliente para un archivo pequeño; sin caché no baja de
 * ~800 ms por llamada.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Diagnostic } from '../../agentTools';

export interface ProposedDiagnostics {
  /** `false` si no se pudo comprobar (sin tsconfig, sin typescript…): ver `note`. */
  checked: boolean;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  note?: string;
}

const EMPTY: ProposedDiagnostics = { checked: false, diagnostics: [], errorCount: 0, warningCount: 0 };

/** Clave de comparación de rutas: absoluta, con `/` y sin distinguir mayúsculas (Windows). */
function samePathKey(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/** Sólo vale el compilador de verdad: hay `typescript` parciales que no traen `sys`. */
function looksLikeTypeScript(m: any): boolean {
  return (
    !!m &&
    typeof m.createCompilerHost === 'function' &&
    typeof m.createProgram === 'function' &&
    !!m.sys &&
    typeof m.sys.readFile === 'function'
  );
}

/**
 * Carga el `typescript` del proyecto y, si no lo tiene (o lo que encuentra no es
 * el compilador), el del propio Commander. No se añade como dependencia nueva:
 * en un repo que compila, ya está.
 */
function loadTypeScript(rootAbs: string): any {
  const from = [
    () => createRequire(path.join(rootAbs, 'package.json'))('typescript'),
    () => createRequire(path.join(process.cwd(), 'package.json'))('typescript'),
    () => createRequire(import.meta.url)('typescript'),
  ];
  for (const load of from) {
    try {
      const mod = load();
      if (looksLikeTypeScript(mod)) return mod;
    } catch { /* se prueba la siguiente base */ }
  }
  return null;
}

/**
 * `SourceFile` ya parseados, validados contra el disco en cada uso.
 *
 * Reparsear los `.d.ts` de `node_modules` en cada llamada es lo que hacía que
 * un typecheck costara segundos. El `mtime`/tamaño en la clave de validación
 * evita el problema obvio de una caché así: servir una versión vieja de un
 * archivo que el usuario acaba de cambiar.
 */
const sourceCache = new Map<string, { mtimeMs: number; size: number; sf: any }>();
const SOURCE_CACHE_LIMIT = 4000;

function cachedGetSourceFile(
  orig: (file: string, lang: any, onError: any, shouldCreate?: boolean) => any,
  file: string,
  lang: any,
  onError: any,
  shouldCreate?: boolean
): any {
  let stamp: { mtimeMs: number; size: number };
  try {
    const st = fs.statSync(file);
    stamp = { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return orig(file, lang, onError, shouldCreate); // no existe: que decida tsc
  }
  const key = `${typeof lang === 'object' ? JSON.stringify(lang) : String(lang)}|${file}`;
  const hit = sourceCache.get(key);
  if (hit && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.sf;

  const sf = orig(file, lang, onError, shouldCreate);
  if (sf) {
    if (sourceCache.size >= SOURCE_CACHE_LIMIT) sourceCache.clear();
    sourceCache.set(key, { ...stamp, sf });
  }
  return sf;
}

export function diagnoseProposed(rootAbs: string, relPath: string, content: string): ProposedDiagnostics {
  const cfgPath = path.join(rootAbs, 'tsconfig.json');
  if (!fs.existsSync(cfgPath)) {
    return { ...EMPTY, note: 'Sin tsconfig.json: no hay tipos que comprobar.' };
  }
  const ts = loadTypeScript(rootAbs);
  if (!ts) {
    return { ...EMPTY, note: 'typescript no está instalado (npm i -D typescript).' };
  }

  const readConfig = ts.readConfigFile(cfgPath, ts.sys.readFile);
  if (readConfig.error) {
    return {
      ...EMPTY,
      note: `tsconfig.json inválido: ${ts.flattenDiagnosticMessageText(readConfig.error.messageText, ' ')}`,
    };
  }
  const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, rootAbs, undefined, cfgPath);

  const absTarget = path.resolve(rootAbs, relPath);
  const targetKey = samePathKey(absTarget);
  const options = { ...parsed.options, noEmit: true };

  const host = ts.createCompilerHost(options, true);
  const origReadFile = host.readFile.bind(host);
  const origGetSourceFile = host.getSourceFile.bind(host);
  // El único archivo que se sirve desde memoria es el propuesto; el resto sale
  // del disco tal cual (o de la caché, validada por mtime), para que los imports
  // y los tipos del proyecto manden.
  host.readFile = (file: string) => (samePathKey(file) === targetKey ? content : origReadFile(file));
  host.getSourceFile = (file: string, lang: any, onError: any, shouldCreate?: boolean) =>
    samePathKey(file) === targetKey
      ? ts.createSourceFile(file, content, lang, true)
      : cachedGetSourceFile(origGetSourceFile, file, lang, onError, shouldCreate);

  try {
    const program = ts.createProgram({ rootNames: [absTarget], options, host });
    const own = program.getSourceFile(absTarget);
    if (!own) return { ...EMPTY, note: 'typescript no pudo cargar el borrador (¿extensión no soportada?).' };
    // Preguntar por el archivo y no por el programa entero: los diagnósticos
    // ajenos se descartaban igual, y calcularlos no era gratis.
    const raw = [...program.getSyntacticDiagnostics(own), ...program.getSemanticDiagnostics(own)];
    const diagnostics: Diagnostic[] = [];
    for (const d of raw) {
      // Los errores de configuración (sin archivo) y los de archivos importados
      // no son del cambio propuesto: ya estaban ahí antes.
      if (!d.file || samePathKey(d.file.fileName) !== targetKey) continue;
      const pos = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
      diagnostics.push({
        file: relPath.replace(/\\/g, '/'),
        line: pos.line + 1,
        column: pos.character + 1,
        severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        code: `TS${d.code}`,
        message: String(ts.flattenDiagnosticMessageText(d.messageText, ' ')).slice(0, 500),
      });
    }
    diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
    const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
    return {
      checked: true,
      diagnostics: diagnostics.slice(0, 50),
      errorCount,
      warningCount: diagnostics.length - errorCount,
    };
  } catch (e: any) {
    return { ...EMPTY, note: `No se pudo compilar el borrador: ${String(e?.message || e).slice(0, 300)}` };
  }
}
