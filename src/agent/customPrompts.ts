/**
 * Expansión de comandos del proyecto en el chat.
 *
 * Si el objetivo empieza por `/nombre args`, se sustituye por el cuerpo del
 * comando con sus argumentos. El agente elegido se añade delante como
 * instrucciones: así el mismo comando se comporta distinto según quién lo lleve.
 */

export interface ProjectPrompt {
  id: string;
  name: string;
  description: string;
  body: string;
}

const COMMAND_RE = /^\/([A-Za-z0-9_.-]+)\s*([\s\S]*)$/;

/** Comando invocado al principio del texto, con sus argumentos. */
export function findCommand(
  text: string,
  commands: ProjectPrompt[]
): { command: ProjectPrompt; args: string } | null {
  const match = String(text ?? '').trim().match(COMMAND_RE);
  if (!match) return null;
  const key = match[1].toLowerCase();
  const command = (commands || []).find(
    (item) => item.id.toLowerCase() === key || item.name.toLowerCase() === key
  );
  return command ? { command, args: match[2].trim() } : null;
}

/**
 * Cuerpo del comando con `$ARGUMENTS` / `$1..$9` sustituidos.
 *
 * Si el cuerpo no tiene marcadores y hay argumentos, se añaden al final: es lo
 * que espera quien escribe `/revisar el diff` sin preparar la plantilla.
 */
export function expandCommand(text: string, commands: ProjectPrompt[]): string {
  const original = String(text ?? '').trim();
  const found = findCommand(original, commands);
  if (!found) return original;
  const { command, args } = found;
  let body = command.body;

  if (body.includes('$ARGUMENTS')) {
    body = body.split('$ARGUMENTS').join(args);
  } else {
    const parts = args ? args.split(/\s+/) : [];
    body = body.replace(/\$([1-9])/g, (_all, index: string) => parts[Number(index) - 1] || '');
    if (args && !/\$[1-9]/.test(command.body)) body = body + '\n\n' + args;
  }
  return body.trim();
}

/** Prefija las instrucciones del agente, si hay uno elegido. */
export function withAgentInstructions(goal: string, agent: ProjectPrompt | null | undefined): string {
  const texto = String(goal ?? '').trim();
  if (!agent) return texto;
  return `[AGENTE: ${agent.name || agent.id}]\n${agent.body}\n\nTAREA:\n${texto}`;
}
