/**
 * F4A-5: la extensión de VS Code es un cliente fino.
 *
 * Este test lee `vscode-extension/src` y falla si aparece:
 *   • un import del agente/servidor del repo o una dependencia fuera de la
 *     allowlist (node-pty, SDKs de LLM, etc.);
 *   • ejecución local de tools o evaluación local de aprobaciones;
 *   • un proceso que no sea el servidor empaquetado: `commander serve`.
 *
 * Se analiza el AST de TypeScript (no texto) para que comentarios y strings no
 * den falsos positivos. Corre en la suite node (`npm run test:node`), que ya
 * forma parte del pre-push y de CI.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_SRC = path.join(REPO, 'vscode-extension', 'src');
const SERVER_FILE = path.join(EXT_SRC, 'server.ts');

/** Builtins que un cliente fino puede usar. `child_process` se valida aparte. */
const ALLOWED_BARE = new Set([
  'vscode',
  'fs',
  'path',
  'http',
  'https',
  'child_process',
  'node:fs',
  'node:path',
  'node:http',
  'node:https',
  'node:child_process',
]);

/**
 * Símbolos que pertenecen al bucle, a las tools o al motor de permisos. Si
 * aparecen en la extensión, alguien copió lógica en vez de llamar al servidor.
 */
const FORBIDDEN_SYMBOLS = new Set([
  'executeAgentTool',
  'executeTool',
  'executeToolCall',
  'executeToolCalls',
  'runAgentTool',
  'TOOL_REGISTRY',
  'AGENT_TOOLS',
  'requiresApproval',
  'sessionApprovalRules',
  'evaluateApproval',
  'approvalTarget',
  'applyProposalToFile',
  'createAgentSession',
]);

/** Funciones de `child_process`; sólo se admite `spawn` en server.ts. */
const PROCESS_FUNCTIONS = new Set([
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]);

interface Finding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  return walk(EXT_SRC).sort();
}

function rel(file: string): string {
  return path.relative(REPO, file).replace(/\\/g, '/');
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function finding(source: ts.SourceFile, file: string, node: ts.Node, rule: string, detail: string): Finding {
  return { file: rel(file), line: lineOf(source, node), rule, detail };
}

function format(findings: Finding[]): string {
  return findings.map((item) => `${item.file}:${item.line} [${item.rule}] ${item.detail}`).join('\n');
}

/** Recorre todos los nodos sin depender de APIs internas del compilador. */
function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function stringLiteral(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function moduleSpecifierOf(node: ts.Node): ts.Expression | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier ?? null;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const callee = node.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
      return node.arguments[0];
    }
  }
  return null;
}

function isInsideExtension(file: string): boolean {
  const resolved = path.resolve(file);
  return resolved === EXT_SRC || resolved.startsWith(EXT_SRC + path.sep);
}

function checkImports(file: string, source: ts.SourceFile, findings: Finding[]): void {
  walk(source, (node) => {
    const specifierNode = moduleSpecifierOf(node);
    const specifier = specifierNode ? stringLiteral(specifierNode) : null;
    if (!specifier) return;

    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!isInsideExtension(resolved)) {
        findings.push(
          finding(source, file, node, 'import', `"${specifier}" sale de vscode-extension/src (${rel(resolved)})`)
        );
        return;
      }
      const segments = specifier.split(/[\\/]/);
      if (segments.includes('agent') || segments.some((part) => /^agentSession|^toolResultRefs/.test(part))) {
        findings.push(finding(source, file, node, 'import', `"${specifier}" apunta al agente`));
      }
      return;
    }

    if (!ALLOWED_BARE.has(specifier)) {
      findings.push(finding(source, file, node, 'import', `dependencia no permitida: "${specifier}"`));
    }
  });
}

function checkForbiddenSymbols(file: string, source: ts.SourceFile, findings: Finding[]): void {
  walk(source, (node) => {
    if (!ts.isIdentifier(node)) return;
    if (!FORBIDDEN_SYMBOLS.has(node.text)) return;
    findings.push(finding(source, file, node, 'agente', `símbolo del bucle/tools/permisos: ${node.text}`));
  });
}

interface ProcessCall {
  file: string;
  source: ts.SourceFile;
  node: ts.CallExpression;
  method: string;
}

/** ¿Es `require('child_process')` / `import('child_process')` (o `node:`)? */
function isChildProcessModuleCall(node: ts.CallExpression): boolean {
  if (node.arguments.length !== 1) return false;
  const callee = node.expression;
  const dynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
  const commonJs = ts.isIdentifier(callee) && callee.text === 'require';
  if (!dynamicImport && !commonJs) return false;
  const specifier = stringLiteral(node.arguments[0]);
  return specifier === 'child_process' || specifier === 'node:child_process';
}

function checkProcesses(file: string, source: ts.SourceFile, findings: Finding[]): ProcessCall[] {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  const direct: ProcessCall[] = [];

  const addNamed = (local: string, imported: string, node: ts.Node): void => {
    named.set(local, imported);
    if (!PROCESS_FUNCTIONS.has(imported)) {
      findings.push(finding(source, file, node, 'proceso', `importa ${imported} de child_process`));
    }
  };

  walk(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!['child_process', 'node:child_process'].includes(node.moduleSpecifier.text)) return;
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) return;
      if (path.resolve(file) !== SERVER_FILE) {
        findings.push(finding(source, file, node, 'proceso', 'sólo server.ts puede importar child_process'));
      }
      if (clause.name) namespaces.add(clause.name.text);
      if (!clause.namedBindings) return;
      if (ts.isNamespaceImport(clause.namedBindings)) {
        namespaces.add(clause.namedBindings.name.text);
        return;
      }
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        addNamed(element.name.text, element.propertyName?.text ?? element.name.text, element);
      }
      return;
    }

    // CommonJS (`const cp = require(...)`) e import dinámico (`await import(...)`).
    if (!ts.isCallExpression(node) || !isChildProcessModuleCall(node)) return;
    if (path.resolve(file) !== SERVER_FILE) {
      findings.push(finding(source, file, node, 'proceso', 'sólo server.ts puede usar require/import de child_process'));
    }

    // `require(...).spawn(...)` directo, o `const spawn = require(...).spawn`.
    if (ts.isPropertyAccessExpression(node.parent)) {
      const property = node.parent;
      const method = property.name.text;
      if (ts.isCallExpression(property.parent) && property.parent.expression === property) {
        direct.push({ file, source, node: property.parent, method });
      } else if (ts.isVariableDeclaration(property.parent) && ts.isIdentifier(property.parent.name)) {
        addNamed(property.parent.name.text, method, property);
      }
      return;
    }

    // `const cp = require(...)`, `const { spawn } = require(...)`, con await/parens.
    let host: ts.Node = node;
    while (ts.isParenthesizedExpression(host.parent) || ts.isAwaitExpression(host.parent)) host = host.parent;
    const parent = host.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === host) {
      if (ts.isIdentifier(parent.name)) {
        namespaces.add(parent.name.text);
      } else if (ts.isObjectBindingPattern(parent.name)) {
        for (const element of parent.name.elements) {
          if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
          const imported = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text;
          addNamed(element.name.text, imported, element);
        }
      }
    }
  });

  const calls: ProcessCall[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    let method: string | null = null;
    if (ts.isIdentifier(node.expression)) {
      method = named.get(node.expression.text) ?? null;
    } else if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      namespaces.has(node.expression.expression.text)
    ) {
      method = node.expression.name.text;
    }
    if (!method) return;
    calls.push({ file, source, node, method });
    if (!PROCESS_FUNCTIONS.has(method)) {
      findings.push(finding(source, file, node, 'proceso', `llama a ${method} de child_process`));
    }
  });

  return [...direct, ...calls];
}

/** La única llamada permitida: `spawn(process.execPath, [cli, 'serve', …])`. */
function checkServeSpawn(call: ProcessCall, findings: Finding[]): void {
  const { file, source, node, method } = call;
  if (method !== 'spawn') {
    findings.push(finding(source, file, node, 'proceso', `sólo se permite spawn, no ${method}`));
    return;
  }
  if (path.resolve(file) !== SERVER_FILE) {
    findings.push(finding(source, file, node, 'proceso', 'sólo server.ts puede arrancar procesos'));
    return;
  }
  const first = node.arguments[0];
  const command = first && ts.isPropertyAccessExpression(first) ? first.getText(source) : '';
  if (command !== 'process.execPath') {
    findings.push(finding(source, file, node, 'proceso', `el ejecutable debe ser process.execPath, no "${command}"`));
  }
  const args = node.arguments[1];
  if (!args || !ts.isArrayLiteralExpression(args)) {
    findings.push(finding(source, file, node, 'proceso', 'los argumentos del servidor deben ser un array literal'));
    return;
  }

  const cliVariable = (() => {
    let name: string | null = null;
    walk(source, (candidate) => {
      if (!ts.isVariableDeclaration(candidate) || !ts.isIdentifier(candidate.name) || !candidate.initializer) return;
      if (!ts.isCallExpression(candidate.initializer)) return;
      const callee = candidate.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === 'bundledCliPath') name = candidate.name.text;
    });
    return name;
  })();
  const head = args.elements[0];
  if (!cliVariable || !head || !ts.isIdentifier(head) || head.text !== cliVariable) {
    findings.push(finding(source, file, node, 'proceso', 'el proceso debe ejecutar el CLI empaquetado (bundledCliPath)'));
  }

  const allowedStrings = new Set(['serve', '--port', '--host', '127.0.0.1']);
  for (const element of args.elements) {
    if (ts.isStringLiteralLike(element)) {
      if (!allowedStrings.has(element.text)) {
        findings.push(finding(source, file, node, 'proceso', `argumento no permitido: "${element.text}"`));
      }
    } else if (!ts.isIdentifier(element)) {
      findings.push(finding(source, file, node, 'proceso', 'argumento no reconocido en el arranque del servidor'));
    }
  }
  const strings = args.elements.map((element) => stringLiteral(element));
  const second = args.elements[1];
  if (!second || stringLiteral(second) !== 'serve') {
    findings.push(finding(source, file, node, 'proceso', '"serve" debe ser el primer argumento después del CLI'));
  }
  if (strings.filter((value) => value === 'serve').length !== 1) {
    findings.push(finding(source, file, node, 'proceso', 'el proceso debe ser exactamente "commander serve"'));
  }
}

describe('F4A-5: frontera de la extensión de VS Code', () => {
  test('la extensión no importa el agente ni dependencias prohibidas', () => {
    const files = sourceFiles();
    assert.ok(files.length >= 7, `no se encontraron los módulos de vscode-extension/src (${files.length})`);
    const findings: Finding[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      checkImports(file, source, findings);
    }
    assert.deepEqual(findings, [], `\n${format(findings)}\n`);
  });

  test('la extensión no ejecuta tools ni evalúa aprobaciones localmente', () => {
    const findings: Finding[] = [];
    for (const file of sourceFiles()) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      checkForbiddenSymbols(file, source, findings);
    }
    assert.deepEqual(findings, [], `\n${format(findings)}\n`);
  });

  test('el único proceso es commander serve con el CLI empaquetado', () => {
    const findings: Finding[] = [];
    const calls: ProcessCall[] = [];
    for (const file of sourceFiles()) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      calls.push(...checkProcesses(file, source, findings));
    }
    for (const call of calls) checkServeSpawn(call, findings);

    const serveCalls = calls.filter((call) => call.method === 'spawn' && path.resolve(call.file) === SERVER_FILE);
    assert.equal(serveCalls.length, 1, `se esperaba un único spawn en server.ts, hay ${serveCalls.length}`);
    assert.deepEqual(findings, [], `\n${format(findings)}\n`);
  });
});
