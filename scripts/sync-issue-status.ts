/**
 * Sincroniza la columna `Estado` de las tablas de F1 con GitHub.
 *
 * Lee los enlaces `[#N](https://github.com/owner/repo/issues/N)` de:
 *   - docs/parity/issues/README.md
 *   - docs/parity/backlog-f1.md
 *
 * y cambia sólo la celda `Abierto`/`Cerrado` de cada fila. El resto de la tabla
 * (títulos, labels, estimaciones y dependencias) no se toca.
 *
 * Uso:
 *   npm run sync:issue-status
 *   npm run check:issue-status   # no escribe; sale 1 por estados o criterios sin marcar
 *
 * Token: GITHUB_TOKEN o GH_TOKEN. Sin token funciona en repos públicos, con el
 * límite de 60 peticiones/hora de la API de GitHub; para este backlog sobra.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TABLE_FILES = [
  'docs/parity/issues/README.md',
  'docs/parity/backlog-f1.md',
] as const;

export type IssueStatus = 'Abierto' | 'Cerrado';

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

export interface IssueRow {
  id: string;
  issue: IssueRef;
  status: IssueStatus;
  statusIndex: number;
  /** Índice de la fila en el texto, separado por líneas. */
  lineIndex: number;
}

export interface StatusChange {
  id: string;
  from: IssueStatus;
  to: IssueStatus;
}

export interface IssueSnapshot {
  status: IssueStatus;
  uncheckedCriteria: string[];
}

interface TableDocument {
  file: string;
  text: string;
  rows: IssueRow[];
}

interface TableDocumentWithChanges extends TableDocument {
  nextText: string;
  changes: StatusChange[];
}

const ISSUE_LINK =
  /^\[#(\d+)\]\(https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\)$/;

const issueKey = (issue: IssueRef): string => `${issue.owner}/${issue.repo}#${issue.number}`;

/**
 * Extrae las filas de una tabla de F1. La celda de estado es la que sigue al
 * enlace del issue, así que funciona con las dos tablas aunque sus columnas
 * estén en otro orden.
 */
export function parseRows(markdown: string): IssueRow[] {
  const rows: IssueRow[] = [];
  const seen = new Set<string>();

  markdown.split(/\r?\n/).forEach((line, lineIndex) => {
    if (!line.trimStart().startsWith('|')) return;
    const cells = line.split('|');
    const idMatch = cells[1]?.match(/\bF1-\d+\b/);
    if (!idMatch) return;

    const issueIndex = cells.findIndex(
      (cell, index) => index > 1 && ISSUE_LINK.test(cell.trim())
    );
    if (issueIndex < 0) {
      throw new Error(`la fila F1 de la línea ${lineIndex + 1} no tiene un enlace de issue válido`);
    }

    const link = ISSUE_LINK.exec(cells[issueIndex].trim());
    if (!link) throw new Error(`enlace de issue inválido en la línea ${lineIndex + 1}`);

    const statusIndex = issueIndex + 1;
    const status = cells[statusIndex]?.trim();
    if (status !== 'Abierto' && status !== 'Cerrado') {
      throw new Error(
        `la fila ${idMatch[0]} (línea ${lineIndex + 1}) no tiene estado Abierto/Cerrado`
      );
    }

    const id = idMatch[0];
    if (seen.has(id)) throw new Error(`fila duplicada para ${id}`);
    seen.add(id);

    rows.push({
      id,
      issue: {
        owner: link[2],
        repo: link[3],
        number: Number(link[1]),
      },
      status,
      statusIndex,
      lineIndex,
    });
  });

  return rows;
}

/** Aplica estados ya resueltos; no hace red ni escribe archivos. */
export function applyStatuses(
  markdown: string,
  statuses: ReadonlyMap<string, IssueStatus>
): { text: string; changes: StatusChange[] } {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const changes: StatusChange[] = [];

  for (const row of parseRows(markdown)) {
    const next = statuses.get(row.id);
    if (!next) throw new Error(`falta el estado de ${row.id}`);
    if (next === row.status) continue;

    const cells = lines[row.lineIndex].split('|');
    cells[row.statusIndex] = ` ${next} `;
    lines[row.lineIndex] = cells.join('|');
    changes.push({ id: row.id, from: row.status, to: next });
  }

  return { text: lines.join(eol), changes };
}

const ACCEPTANCE_HEADING = /^\s*\*\*Criterios de aceptación\*\*\s*$/;
const UNCHECKED_CRITERION = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/;

/**
 * Devuelve los criterios sin marcar de la sección de aceptación. No cuenta los
 * checkboxes de otras secciones ni los criterios que ya están marcados.
 */
export function findUncheckedCriteria(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => ACCEPTANCE_HEADING.test(line));
  if (headingIndex < 0) return [];

  const unchecked: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(?:\*\*|#{1,6}\s)/.test(line)) break;
    const match = UNCHECKED_CRITERION.exec(line);
    if (match) unchecked.push(match[1]);
  }
  return unchecked;
}

function validateSameIssues(tables: TableDocument[]): void {
  if (tables.length === 0) throw new Error('no hay tablas que sincronizar');
  const expected = new Set(tables[0].rows.map((row) => row.id));
  for (const table of tables.slice(1)) {
    const actual = new Set(table.rows.map((row) => row.id));
    const missing = [...expected].filter((id) => !actual.has(id));
    const extra = [...actual].filter((id) => !expected.has(id));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `${table.file} no tiene los mismos issues que ${tables[0].file}` +
          (missing.length ? `; faltan: ${missing.join(', ')}` : '') +
          (extra.length ? `; sobran: ${extra.join(', ')}` : '')
      );
    }
  }
}

async function fetchIssueSnapshot(issue: IssueRef, token?: string): Promise<IssueSnapshot> {
  const apiBase = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
  const url = `${apiBase}/repos/${encodeURIComponent(issue.owner)}/${encodeURIComponent(issue.repo)}/issues/${issue.number}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'commander-issue-status-sync',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
    const hint =
      response.status === 403 || response.status === 429
        ? ' (define GITHUB_TOKEN o GH_TOKEN para subir el límite)'
        : '';
    throw new Error(
      `GitHub respondió ${response.status} al leer ${issueKey(issue)}${hint}` +
        (detail ? `: ${detail}` : '')
    );
  }

  const data = (await response.json()) as { state?: unknown; body?: unknown };
  const status =
    data.state === 'open' ? 'Abierto' : data.state === 'closed' ? 'Cerrado' : null;
  if (!status) {
    throw new Error(`${issueKey(issue)} devolvió un estado desconocido: ${String(data.state)}`);
  }
  return {
    status,
    uncheckedCriteria:
      status === 'Cerrado' && typeof data.body === 'string'
        ? findUncheckedCriteria(data.body)
        : [],
  };
}

/**
 * Consulta GitHub y actualiza ambas tablas. Con `check` no escribe: devuelve
 * `changed` para que el llamador pueda fallar en CI.
 */
export async function syncIssueStatus(options: {
  check?: boolean;
  token?: string;
} = {}): Promise<{ changed: boolean; changes: Array<StatusChange & { file: string }> }> {
  const files = TABLE_FILES;
  const tables: TableDocument[] = files.map((file) => {
    const text = readFileSync(file, 'utf8');
    return { file, text, rows: parseRows(text) };
  });

  if (tables.some((table) => table.rows.length === 0)) {
    throw new Error('no se encontraron filas F1 en las tablas');
  }
  validateSameIssues(tables);

  const refs = new Map<string, IssueRef>();
  for (const table of tables) {
    for (const row of table.rows) refs.set(issueKey(row.issue), row.issue);
  }

  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const idsByKey = new Map<string, string[]>();
  for (const table of tables) {
    for (const row of table.rows) {
      const key = issueKey(row.issue);
      const ids = idsByKey.get(key) ?? [];
      if (!ids.includes(row.id)) ids.push(row.id);
      idsByKey.set(key, ids);
    }
  }

  const snapshots = new Map(
    await Promise.all(
      [...refs.entries()].map(
        async ([key, issue]) => [key, await fetchIssueSnapshot(issue, token)] as const
      )
    )
  );

  const closedWithUnchecked = [...snapshots.entries()].filter(
    ([, snapshot]) => snapshot.status === 'Cerrado' && snapshot.uncheckedCriteria.length > 0
  );
  if (closedWithUnchecked.length > 0) {
    const details = closedWithUnchecked
      .map(([key, snapshot]) => {
        const ids = idsByKey.get(key)?.join(', ') ?? key;
        return `- ${ids} (${key}): ${snapshot.uncheckedCriteria.join(' | ')}`;
      })
      .join('\n');
    throw new Error(`issues cerrados con criterios de aceptación sin marcar:\n${details}`);
  }

  const statuses = new Map<string, IssueStatus>();
  for (const table of tables) {
    for (const row of table.rows) {
      const snapshot = snapshots.get(issueKey(row.issue));
      if (!snapshot) throw new Error(`no se resolvió el estado de ${row.id}`);
      statuses.set(row.id, snapshot.status);
    }
  }

  const updated: TableDocumentWithChanges[] = tables.map((table) => {
    const result = applyStatuses(table.text, statuses);
    return { ...table, nextText: result.text, changes: result.changes };
  });

  const changes = updated.flatMap((table) =>
    table.changes.map((change) => ({ ...change, file: table.file }))
  );

  if (!options.check) {
    for (const table of updated) {
      if (table.nextText !== table.text) writeFileSync(table.file, table.nextText, 'utf8');
    }
  }

  return { changed: changes.length > 0, changes };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help')) {
    console.log(
      'Uso: npm run sync:issue-status [-- --check]\n' +
        '  --check  no escribe; sale 1 si la columna Estado no coincide con GitHub\n' +
        '           o si un issue cerrado conserva criterios sin marcar'
    );
    return;
  }

  const check = args.has('--check');
  const result = await syncIssueStatus({ check });
  for (const change of result.changes) {
    console.log(`[issue-status] ${change.file} ${change.id}: ${change.from} -> ${change.to}`);
  }

  if (result.changed && check) {
    console.error(
      `[issue-status] ${result.changes.length} cambio(s) pendiente(s); ejecuta npm run sync:issue-status`
    );
    process.exitCode = 1;
    return;
  }
  if (!result.changed) {
    console.log('[issue-status] las dos tablas ya coinciden con GitHub');
    return;
  }
  console.log(`[issue-status] ${result.changes.length} cambio(s) aplicado(s) en las dos tablas`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[issue-status] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
