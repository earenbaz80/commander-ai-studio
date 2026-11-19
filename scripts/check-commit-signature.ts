/**
 * Falla si un commit lleva una firma que no es la del autor del repo.
 *
 * El historial ya se reescribió una vez para quitar trailers de herramientas
 * (`🤖 Generated with …`, `Co-Authored-By:`): son fáciles de reintroducir sin
 * querer, porque no cambian el código y ningún test los mira. Este script los
 * busca en el mensaje y en la identidad, que son las dos formas en que aparece
 * una firma.
 *
 * Se compara línea a línea a propósito: `co-authored-by` en medio de una frase
 * es prosa, un trailer es una línea que empieza con la etiqueta. Igual con las
 * herramientas: «generated with» seguido de un nombre conocido es una firma;
 * nombrar a un proveedor en otro contexto, no.
 *
 * Uso:
 *   npm run check:commit-signature                     # toda la historia de HEAD
 *   npm run check:commit-signature -- --range origin/main..HEAD
 *   npm run check:commit-signature -- --message-file .git/COMMIT_EDITMSG   (hook)
 *
 * Sale 1 con los commits y el motivo; 0 si todas las firmas son la del autor.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** La única identidad permitida. `.mailmap` la fija para los alias viejos. */
export const FIRMA = {
  nombre: 'Edel Arencibia Baez',
  email: 'edelarencibiabaez@gmail.com',
} as const;

export type Hallazgo = { motivo: string; linea: string };

/**
 * Reglas de firma ajena. Cada una explica el motivo para que el mensaje de
 * error diga qué arreglar, no sólo que algo falló.
 */
const REGLAS: ReadonlyArray<{ motivo: string; patron: RegExp }> = [
  {
    motivo: 'trailer de co-autoría (la firma es una sola)',
    patron: /^[ \t]*co-authored-by[ \t]*:/i,
  },
  { motivo: 'marca de herramienta (emoji de bot)', patron: /🤖/ },
  {
    motivo: 'atribución a una herramienta de IA',
    patron:
      /\b(?:generated|authored|assisted|written|signed)[^\n]{0,24}\b(?:codebuff|claude|chatgpt|copilot|devin|aider|cursor|windsurf|openai|anthropic)\b/i,
  },
  {
    motivo: 'correo noreply de una herramienta',
    patron: /noreply@(?:codebuff|anthropic|openai)\./i,
  },
];

/** Líneas del mensaje que firman algo distinto del autor. */
export function firmasEnMensaje(mensaje: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const linea of mensaje.replace(/\r\n/g, '\n').split('\n')) {
    for (const regla of REGLAS) {
      if (regla.patron.test(linea)) {
        hallazgos.push({ motivo: regla.motivo, linea: linea.trim() });
        break;
      }
    }
  }
  return hallazgos;
}

export type Identidad = { nombre: string; email: string };

/** `null` si autor y committer son la firma; si no, el desvío. */
export function desvioDeIdentidad(autor: Identidad, committer: Identidad): string | null {
  const compara = (quien: Identidad, papel: string): string | null => {
    if (quien.nombre !== FIRMA.nombre) {
      return `${papel}: «${quien.nombre}» no es «${FIRMA.nombre}»`;
    }
    if (quien.email.toLowerCase() !== FIRMA.email) {
      return `${papel}: «${quien.email}» no es «${FIRMA.email}»`;
    }
    return null;
  };
  return compara(autor, 'autor') ?? compara(committer, 'committer');
}

const CAMPO = '\u001f';
const REGISTRO = '\u001e';

type CommitRevisado = {
  hash: string;
  autor: Identidad;
  committer: Identidad;
  mensaje: string;
};

/** Lee los commits del rango (por defecto, toda la historia de HEAD). */
export function commitsDelRango(rango: string): CommitRevisado[] {
  const formato = `%H${CAMPO}%an${CAMPO}%ae${CAMPO}%cn${CAMPO}%ce${CAMPO}%B${REGISTRO}`;
  const salida = execFileSync('git', ['log', `--format=${formato}`, rango], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return salida
    .split(REGISTRO)
    .map((registro) => registro.replace(/^\n/, ''))
    .filter((registro) => registro.trim() !== '')
    .map((registro) => {
      const [hash, an, ae, cn, ce, ...resto] = registro.split(CAMPO);
      return {
        hash,
        autor: { nombre: an, email: ae },
        committer: { nombre: cn, email: ce },
        mensaje: resto.join(CAMPO),
      };
    });
}

/** Línea de error de un commit con firma ajena, o `null` si está bien firmado. */
export function problemaDe(commit: CommitRevisado): string | null {
  const motivos = [
    ...firmasEnMensaje(commit.mensaje).map((h) => `${h.motivo}: «${h.linea}»`),
  ];
  const desvio = desvioDeIdentidad(commit.autor, commit.committer);
  if (desvio) motivos.push(desvio);
  if (motivos.length === 0) return null;
  const asunto = commit.mensaje.split('\n')[0]?.trim() ?? '';
  return `  · ${commit.hash.slice(0, 7)} ${asunto.slice(0, 60)} → ${motivos.join(' · ')}`;
}

function opcion(argv: string[], nombre: string): string | undefined {
  const i = argv.indexOf(nombre);
  return i >= 0 ? argv[i + 1] : undefined;
}

function principal(): void {
  const argv = process.argv.slice(2);
  const archivo = opcion(argv, '--message-file');

  // Hook: sólo hay un mensaje, todavía sin commit.
  if (archivo) {
    const mensaje = readFileSync(archivo, 'utf8');
    const hallazgos = firmasEnMensaje(mensaje);
    if (hallazgos.length > 0) {
      console.error('[check:commit-signature] el mensaje lleva una firma ajena:');
      for (const h of hallazgos) console.error(`  · ${h.motivo}: «${h.linea}»`);
      console.error(`[check:commit-signature] la única firma es ${FIRMA.nombre} <${FIRMA.email}>.`);
      process.exitCode = 1;
      return;
    }
    console.log('[check:commit-signature] ok · mensaje sin trailers de IA ni co-autoría');
    return;
  }

  const rango = opcion(argv, '--range') ?? 'HEAD';
  let commits: CommitRevisado[];
  try {
    commits = commitsDelRango(rango);
  } catch {
    console.error(`[check:commit-signature] no pude leer el rango «${rango}» (¿historial superficial?)`);
    process.exitCode = 1;
    return;
  }

  const problemas = commits.map(problemaDe).filter((p): p is string => p !== null);
  if (problemas.length > 0) {
    console.error(`[check:commit-signature] ${problemas.length} commit(s) con firma ajena:`);
    for (const p of problemas) console.error(p);
    console.error(
      `[check:commit-signature] la única firma es ${FIRMA.nombre} <${FIRMA.email}>; ` +
        'quita los trailers o corrige la identidad antes de commitear.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check:commit-signature] ok · ${commits.length} commit(s) firmados por ${FIRMA.nombre} <${FIRMA.email}>`
  );
}

// Sólo corre como CLI: los tests importan las funciones y no deben ejecutarlo.
if (process.argv[1] && /check-commit-signature\.(ts|js)$/.test(process.argv[1])) {
  principal();
}
