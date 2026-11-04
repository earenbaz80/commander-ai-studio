/**
 * Diagnósticos por lenguaje, además de TypeScript.
 *
 * El agente necesita saber si su edición rompió algo en un repo de Python, Go o
 * Rust, no sólo en uno con `tsconfig.json`. Aquí viven las tres decisiones sin
 * dependencias —qué lenguaje hay, cómo se parsea su salida y qué comando se
 * lanza— para poder probarlas con fixtures, y una ejecución que nunca falla el
 * paso: si la herramienta no está instalada, devuelve una nota.
 */
import { execFile } from 'child_process';

export interface LangDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export type LanguageId = 'python' | 'go' | 'rust';

/** Marcadores que identifican cada lenguaje en la raíz del proyecto. */
const MARKERS: Array<{ lang: LanguageId; files: string[] }> = [
  { lang: 'python', files: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'] },
  { lang: 'go', files: ['go.mod'] },
  { lang: 'rust', files: ['Cargo.toml'] },
];

/** Lenguajes detectados a partir de los ficheros de la raíz. */
export function detectProjectLanguages(files: string[]): LanguageId[] {
  const present = new Set((files || []).map((file) => file.toLowerCase()));
  return MARKERS.filter((marker) => marker.files.some((file) => present.has(file.toLowerCase()))).map(
    (marker) => marker.lang
  );
}

/** Comando y argumentos por lenguaje (el binario puede no estar instalado). */
export function commandFor(lang: LanguageId): { command: string; args: string[] } {
  if (lang === 'python') return { command: 'pyright', args: ['--outputjson'] };
  if (lang === 'go') return { command: 'go', args: ['vet', './...'] };
  return { command: 'cargo', args: ['check', '--message-format=json'] };
}

const sev = (value: unknown): 'error' | 'warning' =>
  String(value || '').toLowerCase() === 'warning' ? 'warning' : 'error';

/** `pyright --outputjson`: líneas y columnas 0-based. */
export function parsePyrightJson(raw: string): LangDiagnostic[] {
  let parsed: any;
  try {
    parsed = JSON.parse(String(raw || ''));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.generalDiagnostics) ? parsed.generalDiagnostics : [];
  return list.map((item: any) => ({
    file: String(item?.file || ''),
    line: Number(item?.range?.start?.line ?? 0) + 1,
    column: Number(item?.range?.start?.character ?? 0) + 1,
    severity: sev(item?.severity),
    code: String(item?.rule || ''),
    message: String(item?.message || ''),
  }));
}

/** `cargo check --message-format=json`: una línea JSON por mensaje. */
export function parseCargoJson(raw: string): LangDiagnostic[] {
  const out: LangDiagnostic[] = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    let item: any;
    try {
      item = JSON.parse(text);
    } catch {
      continue;
    }
    if (item?.reason !== 'compiler-message') continue;
    const message = item.message || {};
    const span = Array.isArray(message.spans) ? message.spans[0] : null;
    out.push({
      file: String(span?.file_name || ''),
      line: Number(span?.line_start ?? 0),
      column: Number(span?.column_start ?? 0),
      severity: sev(message.level),
      code: String(message?.code?.code || ''),
      message: String(message.message || ''),
    });
  }
  return out;
}

/** `go vet`: `archivo.go:línea:columna: mensaje`. */
export function parseGoVet(raw: string): LangDiagnostic[] {
  const out: LangDiagnostic[] = [];
  const re = /^(.+?\.go):(\d+):(\d+):\s*(.+)$/;
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.trim().match(re);
    if (!match) continue;
    out.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      severity: 'error',
      code: '',
      message: match[4].trim(),
    });
  }
  return out;
}

/** Parsea la salida del comando del lenguaje. */
export function parseLanguageOutput(lang: LanguageId, raw: string): LangDiagnostic[] {
  if (lang === 'python') return parsePyrightJson(raw);
  if (lang === 'go') return parseGoVet(raw);
  return parseCargoJson(raw);
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && (error as any).code === 'ENOENT') {
          reject(new Error(`no instalado: ${command}`));
          return;
        }
        resolve({ code: typeof (error as any)?.code === 'number' ? (error as any).code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

export interface LanguageDiagnosticsResult {
  diagnostics: LangDiagnostic[];
  /** Lenguajes que se intentaron y no tienen herramienta instalada. */
  skipped: Array<{ lang: LanguageId; reason: string }>;
}

/**
 * Ejecuta el diagnóstico de cada lenguaje detectado.
 *
 * Un fallo del comando (salida distinta de 0) es normal: ahí están los errores.
 * Sólo se salta cuando el binario no existe o la ejecución revienta.
 */
export async function runLanguageDiagnostics(
  root: string,
  files: string[],
  limit = 100
): Promise<LanguageDiagnosticsResult> {
  const diagnostics: LangDiagnostic[] = [];
  const skipped: Array<{ lang: LanguageId; reason: string }> = [];
  for (const lang of detectProjectLanguages(files)) {
    const { command, args } = commandFor(lang);
    try {
      const out = await run(command, args, root);
      diagnostics.push(...parseLanguageOutput(lang, out.stdout || out.stderr));
    } catch (error: any) {
      skipped.push({ lang, reason: error?.message || 'no se pudo ejecutar' });
    }
    if (diagnostics.length >= limit) break;
  }
  return { diagnostics: diagnostics.slice(0, limit), skipped };
}
