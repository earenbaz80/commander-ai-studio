/**
 * Inteligencia de código nativa: el compilador de TypeScript como servicio.
 *
 * Aquí no hay modelo. Todo lo que devuelve este módulo lo sabe el *language
 * service* del proyecto: diagnósticos, símbolos sin usar, referencias y
 * renombrados con sus posiciones exactas. Es lo que hace que un refactor sea
 * verificable en lugar de una apuesta.
 *
 * Vive en el servidor porque necesita `fs` y el `typescript` del proyecto (el
 * de sus `node_modules`, no una copia empaquetada). El servicio se cachea por
 * proyecto durante `TTL_MS` y se invalida a mano cuando el agente escribe
 * (`invalidateCodeIntel`), que es el único momento en que su foto puede quedar
 * vieja.
 */
import fs from 'fs';
import path from 'path';
import { loadTypeScript } from './proposedDiagnostics';
import { checkSource, type RuleViolation } from './projectRules';
import { diffLines, toUnifiedDiff } from '../utils/patch';
import type { Diagnostic } from '../../agentTools';

export interface UnusedImport {
  name: string;
  module: string;
  line: number;
  column: number;
}

export interface CodeIntelAnalysis {
  file: string;
  /** `false` cuando no hay tsconfig o el proyecto no tiene TypeScript. */
  checked: boolean;
  note?: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  unusedImports: UnusedImport[];
  /** Reglas del repo (`color-token`, `i18n-literal`) sobre el archivo. */
  rules: RuleViolation[];
}

export interface SymbolLocation {
  file: string;
  line: number;
  column: number;
  text: string;
  isDefinition: boolean;
}

export interface RenameFile {
  path: string;
  changed: boolean;
  additions: number;
  deletions: number;
  diff: string;
}

export interface RenamePlan {
  symbol: string;
  newName: string;
  locations: number;
  files: RenameFile[];
}

export interface IntelResult<T> {
  ok: boolean;
  data?: T;
  /** Motivo por el que no se pudo analizar (sin tsconfig, sin typescript…). */
  note?: string;
  error?: string;
}

interface Project {
  root: string;
  ts: any;
  service: any;
  parsed: any;
  createdAt: number;
}

const TTL_MS = 60_000;
const projects = new Map<string, Project>();

function cacheKey(root: string): string {
  return path.resolve(root).split(path.sep).join('/').toLowerCase();
}

/** Tira la foto del proyecto: tras una escritura del agente ya no vale. */
export function invalidateCodeIntel(rootAbs?: string): void {
  if (rootAbs) projects.delete(cacheKey(rootAbs));
  else projects.clear();
}

/**
 * Construye el language service sobre el `tsconfig.json` real. La versión de
 * cada archivo sale de `mtime`+tamaño, que es lo que hace que el servicio se
 * entere de una edición sin recrearlo.
 */
function buildProject(rootAbs: string): IntelResult<Project> {
  const cfgPath = path.join(rootAbs, 'tsconfig.json');
  if (!fs.existsSync(cfgPath)) {
    return { ok: false, note: 'Sin tsconfig.json: el análisis estructural sólo cubre proyectos TypeScript.' };
  }
  const ts = loadTypeScript(rootAbs);
  if (!ts) {
    return { ok: false, note: 'typescript no está instalado en este proyecto (npm i -D typescript).' };
  }
  const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
  if (read.error) {
    return { ok: false, note: `tsconfig.json inválido: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}` };
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, rootAbs, undefined, cfgPath);

  const service = ts.createLanguageService({
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (fileName: string) => {
      try {
        const st = fs.statSync(fileName);
        return `${st.mtimeMs}:${st.size}`;
      } catch {
        return '0';
      }
    },
    getScriptSnapshot: (fileName: string) => {
      try {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => rootAbs,
    getCompilationSettings: () => ({ ...parsed.options, noEmit: true }),
    getDefaultLibFileName: (options: any) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    getNewLine: () => '\n',
  });

  return { ok: true, data: { root: rootAbs, ts, service, parsed, createdAt: Date.now() } };
}

function projectFor(rootAbs: string): IntelResult<Project> {
  const key = cacheKey(rootAbs);
  const hit = projects.get(key);
  if (hit && Date.now() - hit.createdAt < TTL_MS) return { ok: true, data: hit };
  const built = buildProject(rootAbs);
  if (built.ok && built.data) projects.set(key, built.data);
  else projects.delete(key);
  return built;
}

/** Ruta absoluta sólo si queda dentro del proyecto. */
function resolveInside(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs === base) return null;
  return abs.startsWith(base.endsWith(path.sep) ? base : base + path.sep) ? abs : null;
}

function relOf(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** Diagnósticos de un archivo del proyecto, con la ruta ya relativa. */
function diagnosticsOf(project: Project, abs: string): Diagnostic[] {
  const { ts, service } = project;
  const out: Diagnostic[] = [];
  const source = service.getProgram()?.getSourceFile(abs);
  if (!source) return out;
  const collect = (raw: any[]) => {
    for (const d of raw) {
      if (!d.file) continue;
      const pos = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
      out.push({
        file: relOf(project.root, d.file.fileName),
        line: pos.line + 1,
        column: pos.character + 1,
        severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        code: `TS${d.code}`,
        message: String(ts.flattenDiagnosticMessageText(d.messageText, ' ')).slice(0, 500),
      });
    }
  };
  collect(service.getSyntacticDiagnostics(abs));
  collect(service.getSemanticDiagnostics(abs));
  out.sort((a, b) => a.line - b.line || a.column - b.column);
  return out.slice(0, 200);
}

/**
 * Imports sin usar, contando usos reales en el AST.
 *
 * Es un recuento de identificadores, no `findReferences`: para «¿se usa este
 * nombre en este archivo?» es exacto en la práctica (tipos, JSX y shorthand
 * también son `Identifier`) y cuesta milisegundos en vez de compilar el grafo
 * entero. Un import que sólo se usa en un tipo cuenta como usado, que es lo que
 * se espera.
 */
function unusedImportsOf(ts: any, sf: any): UnusedImport[] {
  const used = new Map<string, number>();
  const isImportBinding = (node: any): boolean => {
    const parent = node.parent;
    return !!parent && (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent));
  };
  const count = (node: any) => {
    if (ts.isIdentifier(node) && !isImportBinding(node)) used.set(node.text, (used.get(node.text) || 0) + 1);
    ts.forEachChild(node, count);
  };
  count(sf);

  const out: UnusedImport[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const clause = stmt.importClause;
    const moduleName = String(stmt.moduleSpecifier?.text || '');
    const add = (name: any) => {
      if (!name || !ts.isIdentifier(name)) return;
      if ((used.get(name.text) || 0) > 0) return;
      const pos = sf.getLineAndCharacterOfPosition(name.getStart(sf));
      out.push({ name: name.text, module: moduleName, line: pos.line + 1, column: pos.character + 1 });
    };
    if (clause.name) add(clause.name);
    const bindings = clause.namedBindings;
    if (bindings) {
      if (ts.isNamespaceImport(bindings)) add(bindings.name);
      else for (const el of bindings.elements) add(el.name);
    }
  }
  return out;
}

/** Reglas del repo para un contenido, sin necesidad de que el proyecto compile. */
export function rulesFor(rootAbs: string, relPath: string, text: string): RuleViolation[] {
  const ts = loadTypeScript(rootAbs);
  if (!ts) return [];
  try {
    return checkSource(ts, relPath, text);
  } catch {
    return [];
  }
}

/**
 * Diagnósticos + imports sin usar + reglas de un archivo.
 *
 * Sin tsconfig sigue devolviendo las reglas: son útiles en un proyecto sin
 * TypeScript (o sin `npm install` hecho) y no dependen del programa.
 */
export function analyzeSource(rootAbs: string, relPath: string): IntelResult<CodeIntelAnalysis> {
  const abs = resolveInside(rootAbs, relPath);
  if (!abs) return { ok: false, error: `Ruta fuera del proyecto: ${relPath}` };
  if (!fs.existsSync(abs)) return { ok: false, error: `No existe: ${relPath}` };
  const text = fs.readFileSync(abs, 'utf8');
  const rules = rulesFor(rootAbs, relPath, text);

  const project = projectFor(rootAbs);
  if (!project.ok || !project.data) {
    return {
      ok: true,
      data: {
        file: relPath.split('\\').join('/'),
        checked: false,
        note: project.note,
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        unusedImports: [],
        rules,
      },
    };
  }

  const p = project.data;
  const diagnostics = diagnosticsOf(p, abs);
  const sf = p.service.getProgram()?.getSourceFile(abs);
  const unusedImports = sf ? unusedImportsOf(p.ts, sf) : [];
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  return {
    ok: true,
    data: {
      file: relOf(rootAbs, abs),
      checked: true,
      diagnostics,
      errorCount,
      warningCount: diagnostics.length - errorCount,
      unusedImports,
      rules,
    },
  };
}

/** Posición del primer `symbol` que sea nombre de declaración (o el primero). */
function findSymbolNode(ts: any, sf: any, symbol: string): any | null {
  const all: any[] = [];
  const walk = (node: any) => {
    if (ts.isIdentifier(node) && node.text === symbol) all.push(node);
    ts.forEachChild(node, walk);
  };
  walk(sf);
  if (all.length === 0) return null;
  const declaration = all.find((n) => n.parent && n.parent.name === n);
  return declaration || all[0];
}

/** Referencias de un símbolo, agrupadas por archivo, con su definición aparte. */
export function findReferences(rootAbs: string, relPath: string, symbol: string): IntelResult<{ symbol: string; declarations: SymbolLocation[]; references: SymbolLocation[] }> {
  const project = projectFor(rootAbs);
  if (!project.ok || !project.data) return { ok: false, note: project.note };
  const p = project.data;
  const abs = resolveInside(rootAbs, relPath);
  if (!abs) return { ok: false, error: `Ruta fuera del proyecto: ${relPath}` };
  const sf = p.service.getProgram()?.getSourceFile(abs);
  if (!sf) return { ok: false, error: `El archivo no está en el proyecto: ${relPath}` };
  const node = findSymbolNode(p.ts, sf, symbol);
  if (!node) return { ok: false, error: `Símbolo no encontrado en ${relPath}: ${symbol}` };

  const pos = node.getStart(sf);
  const groups = p.service.findReferences(abs, pos) || [];
  const declarations: SymbolLocation[] = [];
  const references: SymbolLocation[] = [];
  for (const group of groups) {
    for (const ref of group.references || []) {
      const source = p.service.getProgram()?.getSourceFile(ref.fileName) || p.ts.createSourceFile(ref.fileName, '', p.ts.ScriptTarget.Latest);
      const at = source.getLineAndCharacterOfPosition(ref.textSpan.start);
      const entry: SymbolLocation = {
        file: relOf(rootAbs, ref.fileName),
        line: at.line + 1,
        column: at.character + 1,
        text: symbol,
        isDefinition: !!ref.isDefinition,
      };
      (ref.isDefinition ? declarations : references).push(entry);
    }
  }
  return { ok: true, data: { symbol, declarations, references } };
}

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface',
  'package', 'private', 'protected', 'public', 'await',
]);

function isValidIdentifier(name: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) && !KEYWORDS.has(name);
}

/**
 * Plan de renombrado: mismas posiciones que usaría el editor, y el resultado
 * como contenido nuevo por archivo. **No escribe nada**: devuelve diffs para
 * que se apliquen con `fs.write` (o se rechacen).
 */
export function planRename(
  rootAbs: string,
  relPath: string,
  opts: { newName: string; symbol?: string; line?: number; column?: number }
): IntelResult<RenamePlan> {
  const newName = String(opts.newName || '').trim();
  if (!isValidIdentifier(newName)) return { ok: false, error: `Nombre inválido: ${newName.slice(0, 80)}` };

  const project = projectFor(rootAbs);
  if (!project.ok || !project.data) return { ok: false, note: project.note };
  const p = project.data;
  const abs = resolveInside(rootAbs, relPath);
  if (!abs) return { ok: false, error: `Ruta fuera del proyecto: ${relPath}` };

  const program = p.service.getProgram();
  const sf = program?.getSourceFile(abs);
  if (!sf) return { ok: false, error: `El archivo no está en el proyecto: ${relPath}` };

  let pos = -1;
  if (opts.line && opts.line > 0) {
    const lineStart = sf.getLineStarts()[opts.line - 1];
    if (lineStart === undefined) return { ok: false, error: `Línea fuera del archivo: ${opts.line}` };
    pos = lineStart + Math.max(0, (opts.column || 1) - 1);
  } else if (opts.symbol) {
    const node = findSymbolNode(p.ts, sf, String(opts.symbol));
    if (!node) return { ok: false, error: `Símbolo no encontrado en ${relPath}: ${opts.symbol}` };
    pos = node.getStart(sf);
  } else {
    return { ok: false, error: 'Indica symbol, o line/column, para saber qué renombrar' };
  }

  let info: any;
  try {
    info = p.service.getRenameInfo(abs, pos, { allowRenameOfImportPath: false });
  } catch (e: any) {
    return { ok: false, error: `No se pudo analizar el símbolo: ${String(e?.message || e).slice(0, 200)}` };
  }
  if (!info || !info.canRename) {
    return { ok: false, error: info?.localizedErrorMessage || 'Ese símbolo no se puede renombrar' };
  }
  const symbol = String(info.displayName || opts.symbol || '');

  let locations: any[];
  try {
    locations = p.service.findRenameLocations(abs, pos, false, false, { providePrefixAndSuffixTextForRename: true }) || [];
  } catch (e: any) {
    return { ok: false, error: `Fallo al calcular el renombrado: ${String(e?.message || e).slice(0, 200)}` };
  }
  if (locations.length === 0) return { ok: false, error: `Sin localizaciones para ${symbol}` };

  const byFile = new Map<string, any[]>();
  for (const loc of locations) {
    const list = byFile.get(loc.fileName) || [];
    list.push(loc);
    byFile.set(loc.fileName, list);
  }

  const files: RenameFile[] = [];
  for (const [fileName, edits] of byFile) {
    let before: string;
    try {
      before = fs.readFileSync(fileName, 'utf8');
    } catch {
      continue;
    }
    edits.sort((a: any, b: any) => a.textSpan.start - b.textSpan.start);
    let after = '';
    let cursor = 0;
    for (const edit of edits) {
      const start = Math.max(cursor, edit.textSpan.start);
      after += before.slice(cursor, start);
      after += String(edit.prefixText || '') + newName + String(edit.suffixText || '');
      cursor = Math.max(cursor, edit.textSpan.start + edit.textSpan.length);
    }
    after += before.slice(cursor);
    const rel = relOf(rootAbs, fileName);
    const diff = diffLines(before, after, 3);
    files.push({
      path: rel,
      changed: before !== after,
      additions: diff.additions,
      deletions: diff.deletions,
      diff: before === after ? '' : toUnifiedDiff(rel, diff, { exists: true }),
    });
  }

  return { ok: true, data: { symbol, newName, locations: locations.length, files } };
}
