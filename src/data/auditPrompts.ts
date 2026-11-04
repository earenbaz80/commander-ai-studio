import type { Language } from '../i18n/translations';
/**
 * Prompt de «Auditoría General»: revisión del proyecto activo.
 * Se mantiene aparte para poder ajustarlo y testearlo sin tocar la UI.
 */

export const AUDIT_LABEL_ES = 'Auditoría General';
export const AUDIT_LABEL_EN = 'General Audit';
export const AUDIT_LABEL_DE = 'Allgemeine Prüfung';

/** Nombre legible del proyecto a partir de su ruta. */
export function projectName(path: string): string {
  if (!path) return '(sin proyecto)';
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * ¿La pestaña apunta a un proyecto de verdad?
 *
 * Vacío, «.» o «./» no lo son: con esa ruta el agente audita el cwd del
 * servidor en vez del proyecto del usuario, y el informe no sirve.
 */
export function hasProjectPath(path?: string | null): boolean {
  const limpio = String(path ?? '').trim().replace(/[\\/]+$/, '');
  return limpio !== '' && limpio !== '.' && limpio !== '..';
}

export function buildAuditPrompt(projectPath: string, lang: Language = 'es'): string {
  const name = projectName(projectPath);
  if (lang === 'de') return buildAuditPromptDe(projectPath);
  if (!projectPath) {
    return lang === 'es'
      ? 'No hay proyecto seleccionado en esta pestaña. Elige o crea un proyecto en el selector de arriba antes de lanzar la auditoría.'
      : 'No project selected in this tab. Pick or create a project in the selector above before running the audit.';
  }

  if (lang === 'es') {
    return `Realiza una AUDITORÍA GENERAL del proyecto "${name}" (directorio: ${projectPath}).

Usa las herramientas para inspeccionarlo de verdad (fs.glob, fs.grep, fs.read, read_diagnostics, shell.run) antes de concluir nada. No inventes hallazgos.

Analiza y reporta, en este orden y con severidad (CRÍTICO / ALTO / MEDIO / BAJO):

1. **Correctitud** — bugs, condiciones de carrera, casos borde no cubiertos, manejo de errores.
2. **Seguridad** — inyección (SQL/cmd/XSS), secretos en código, validación de entrada, criptografía débil, secretos en el cliente.
3. **Rendimiento** — bucles costosos, N+1, falta de memoización, fugas de memoria.
4. **Arquitectura** — acoplamiento, duplicación, responsabilidades mezcladas, módulos gigantes.
5. **Calidad** — deuda técnica, TODOs, código muerto, nombres poco claros, falta de tests.
6. **Higiene** — dependencias desactualizadas o riesgosas, ausencia de lockfile, .gitignore incompleto.

Para cada hallazgo da: archivo y línea, qué falla, por qué importa y una corrección concreta.

Cierra con:
- Un veredicto de 1 línea (SALUDABLE / CON RIESGOS / CRÍTICO).
- Los 3 problemas que arreglarías primero, ordenados.
- Si no encuentras nada en una categoría, dilo explícitamente.`;
  }

  return `Perform a GENERAL AUDIT of the project "${name}" (directory: ${projectPath}).

Use the tools to actually inspect it (fs.glob, fs.grep, fs.read, read_diagnostics, shell.run) before concluding anything. Do not invent findings.

Report, in this order and with severity (CRITICAL / HIGH / MEDIUM / LOW):

1. **Correctness** — bugs, race conditions, uncovered edge cases, error handling.
2. **Security** — injection (SQL/cmd/XSS), secrets in code, input validation, weak crypto, client-side secrets.
3. **Performance** — expensive loops, N+1, missing memoization, memory leaks.
4. **Architecture** — coupling, duplication, mixed responsibilities, oversized modules.
5. **Quality** — tech debt, TODOs, dead code, unclear names, missing tests.
6. **Hygiene** — outdated or risky dependencies, missing lockfile, incomplete .gitignore.

For each finding give: file and line, what breaks, why it matters, and a concrete fix.

Close with:
- A one-line verdict (HEALTHY / AT RISK / CRITICAL).
- The 3 problems to fix first, ordered.
- If a category has no findings, say so explicitly.`;
}

/** Prompt de auditoría en alemán. */
export function buildAuditPromptDe(projectPath: string): string {
  const name = projectName(projectPath);
  if (!projectPath) {
    return 'In diesem Tab ist kein Projekt ausgewählt. Wähle oder erstelle oben im Auswahlfeld ein Projekt, bevor du die Prüfung startest.';
  }
  return `Führe eine ALLGEMEINE PRÜFUNG des Projekts "${name}" durch (Verzeichnis: ${projectPath}).

Nutze die Werkzeuge, um es wirklich zu untersuchen (fs.glob, fs.grep, fs.read, read_diagnostics, shell.run), bevor du etwas feststellst. Erfinde keine Befunde.

Berichte in dieser Reihenfolge und mit Schweregrad (KRITISCH / HOCH / MITTEL / NIEDRIG):

1. **Korrektheit** — Bugs, Race Conditions, ungetestete Randfälle, Fehlerbehandlung.
2. **Sicherheit** — Injection (SQL/Cmd/XSS), Geheimnisse im Code, Eingabevalidierung, schwache Krypto, Client-Secrets.
3. **Leistung** — teure Schleifen, N+1, fehlendes Memoizing, Speicherlecks.
4. **Architektur** — Kopplung, Duplikate, vermischte Zuständigkeiten, überdimensionierte Module.
5. **Qualität** — technische Schulden, TODOs, toter Code, unklare Namen, fehlende Tests.
6. **Hygiene** — veraltete oder riskante Abhängigkeiten, fehlende Lockfile, unvollständige .gitignore.

Gib für jeden Befund an: Datei und Zeile, was kaputtgeht, warum es wichtig ist und eine konkrete Korrektur.

Schließe ab mit:
- Einem einzeiligen Urteil (GESUND / RISIKOREICH / KRITISCH).
- Den 3 Problemen, die zuerst zu beheben sind, sortiert.
- Wenn eine Kategorie keine Befunde hat, sage das ausdrücklich.`;
}
