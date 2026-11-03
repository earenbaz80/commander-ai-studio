import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';

/**
 * Tools de análisis nativo: no llaman a ningún modelo, sólo al compilador y a
 * las herramientas del proyecto. Por eso funcionan sin clave, sin cuota y sin
 * red, y por eso su resultado es verificable.
 */

export interface CodeAnalyzeInput {
  path: string;
  /** Si se indica, añade las referencias de ese símbolo en todo el proyecto. */
  symbol?: string;
}
export interface CodeAnalyzeOutput {
  file: string;
  checked: boolean;
  note?: string;
  diagnostics: { file: string; line: number; column: number; severity: 'error' | 'warning'; code: string; message: string }[];
  errorCount: number;
  warningCount: number;
  unusedImports: { name: string; module: string; line: number; column: number }[];
  rules: { rule: string; file: string; line: number; column: number; message: string; excerpt: string }[];
  references?: {
    symbol: string;
    declarations: { file: string; line: number; column: number; text: string; isDefinition: boolean }[];
    references: { file: string; line: number; column: number; text: string; isDefinition: boolean }[];
  };
}

export const codeAnalyzeTool: ToolDefinition<CodeAnalyzeInput, CodeAnalyzeOutput> = {
  id: 'code.analyze',
  description:
    'Analiza un archivo con el compilador de TypeScript, sin modelo: diagnósticos, imports sin usar, ' +
    'reglas del repo (color/i18n) y, con symbol, sus referencias en todo el proyecto.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callAgentTool('code.analyze', input),
};

export interface CodeRefactorInput {
  path: string;
  newName: string;
  /** Símbolo a renombrar (o line/column, si se conoce la posición exacta). */
  symbol?: string;
  line?: number;
  column?: number;
}
export interface CodeRefactorOutput {
  symbol: string;
  newName: string;
  locations: number;
  files: { path: string; changed: boolean; additions: number; deletions: number; diff: string }[];
}

export const codeRefactorTool: ToolDefinition<CodeRefactorInput, CodeRefactorOutput> = {
  id: 'code.refactor',
  description:
    'Renombrado de símbolo en todo el proyecto usando el lenguaje de TypeScript, SIN tocar disco: ' +
    'devuelve un diff por archivo (se aplica con fs.write). No usa ningún modelo.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callAgentTool('code.refactor', input),
};

export interface CodeFixInput {
  /** Rutas relativas al proyecto. */
  paths: string[];
}
export interface CodeFixOutput {
  files: {
    path: string;
    changed: boolean;
    additions: number;
    deletions: number;
    diff: string;
    eslint: { ran: boolean; exitCode?: number; output?: string; error?: string };
    prettier: { ran: boolean; exitCode?: number; output?: string; error?: string };
  }[];
}

export const codeFixTool: ToolDefinition<CodeFixInput, CodeFixOutput> = {
  id: 'code.fix',
  description:
    'Aplica eslint --fix y prettier sobre los archivos indicados (offline, sin modelo) y devuelve ' +
    'el diff real de lo que cambió. Es la acción «revisar»: deja el archivo según las reglas del repo.',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callAgentTool('code.fix', input),
};
