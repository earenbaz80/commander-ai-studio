/**
 * Guarda de la separación de proyectos de Vitest.
 *
 * `vitest.config.ts` parte la suite en dos: `ui` (tests/ui, jsdom + polyfills) y
 * `node` (tests/unit + tests/mcp, entorno `node`, ver `tests/unit/setup.ts`).
 * Esa separación no se rompe de golpe, se erosiona: alguien añade un
 * `localStorage.getItem` a un test de config y falla en CI en vez de en su
 * máquina, o se «arregla» copiando el setup de UI, y la suite de lógica vuelve a
 * depender del DOM.
 *
 * Se comprueban tres cosas:
 * 1. En ejecución, estos ficheros no tienen `window` ni `document`.
 * 2. Ningún fichero de estas carpetas menciona una API del DOM ni importa la
 *    librería que lo trae.
 * 3. Ningún módulo que un test de lógica importe —ni lo que ese módulo importe,
 *    transitivamente— toca el DOM. Sin esto el caso realista se escaparía: el
 *    test está limpio y el DOM entra por un helper de `src/`, que en `node`
 *    revienta al primer `document.createElement`.
 *
 * Si un test de lógica necesita el DOM de verdad, ese test pertenece a
 * `tests/ui`: moverlo es la respuesta, no añadir polyfills aquí.
 */
import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Carpetas del proyecto `node`, tal como las lista `vitest.config.ts`. */
const CARPETAS = ['tests/unit', 'tests/mcp'];

/** Este fichero nombra a propósito todo lo que prohíbe, así que no se escanea. */
const ESTE_FICHERO = fileURLToPath(import.meta.url);

const EXTENSIONES = ['.ts', '.tsx'];

/** Ruta relativa a la raíz, siempre con `/`, para que el mensaje sea legible. */
function rel(ruta: string): string {
  return path.relative(RAIZ, ruta).split(path.sep).join('/');
}

/**
 * APIs que delatan dependencia del DOM (o de jsdom/happy-dom, que lo traen).
 * Las fronteras de palabra evitan que `document` marque `documentation` o
 * `documentar`. Se usan con `g` para recorrer todas las apariciones.
 */
const PROHIBIDO: Array<{ nombre: string; patron: RegExp }> = [
  { nombre: 'window', patron: /\bwindow\b/g },
  { nombre: 'document', patron: /\bdocument\b/g },
  { nombre: 'localStorage', patron: /\blocalStorage\b/g },
  { nombre: 'sessionStorage', patron: /\bsessionStorage\b/g },
  { nombre: 'navigator', patron: /\bnavigator\b/g },
  { nombre: 'getComputedStyle', patron: /\bgetComputedStyle\b/g },
  { nombre: 'matchMedia', patron: /\bmatchMedia\b/g },
  { nombre: 'requestAnimationFrame', patron: /\brequestAnimationFrame\b/g },
  { nombre: 'ResizeObserver', patron: /\bResizeObserver\b/g },
  { nombre: 'IntersectionObserver', patron: /\bIntersectionObserver\b/g },
  { nombre: 'HTMLElement', patron: /\bHTMLElement\b/g },
  { nombre: '@testing-library', patron: /@testing-library\//g },
  { nombre: 'jest-dom', patron: /jest-dom/g },
  { nombre: 'jsdom', patron: /\bjsdom\b/g },
  { nombre: 'happy-dom', patron: /\bhappy-dom\b/g },
];

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Guarda de entorno: `typeof window !== 'undefined'`,
 * `typeof localStorage === "undefined"`… Es lo que hace que un módulo
 * compartido entre UI y lógica siga funcionando en `node`.
 */
const GUARDA = new RegExp(
  `typeof\\s+(?:${PROHIBIDO.map(({ nombre }) => escapar(nombre)).join('|')})\\b\\s*([!=]=)=?\\s*(?:['"]undefined['"]|undefined)`,
  'g',
);
const GUARDA_EN_TEXTO = new RegExp(GUARDA.source);

/**
 * Comentarios fuera, conservando los saltos de línea: un bloque de varias líneas
 * se sustituye por espacios, así los números de línea citados son los reales.
 * El `[^:]` delante de `//` deja intactos los `http://` de las URLs.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (comentario) => comentario.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export interface Uso {
  /** Número de línea real (1-based). */
  linea: number;
  nombre: string;
  texto: string;
}

/**
 * Usos del DOM que ninguna guarda de entorno cubre.
 *
 * Una guarda exime:
 * - Los usos que vienen detrás en la **misma línea**:
 *   `typeof window !== 'undefined' && window.localStorage`.
 * - Los usos de **dentro de su bloque o de un bloque anidado**, cuando antes hay
 *   un `if (typeof window === 'undefined') return;`. Es la forma de escribir un
 *   módulo compartido, y marcarla sería un falso positivo.
 * - Los operandos que vienen detrás de la comprobación en una condición
 *   repartida en varias líneas, **si la comprobación es positiva**
 *   (`typeof window !== 'undefined' && …`): el cortocircuito garantiza que sin
 *   `window` no se evalúan. Con la negativa (`=== 'undefined' || …`) no se
 *   exime, porque ahí sí se evaluarían.
 *
 * Si la guarda abre bloque (`if (typeof window !== 'undefined') { … }`), protege
 * sólo ese bloque: al cerrarse deja de cubrir, porque lo de después vuelve a
 * correr sin comprobar nada.
 *
 * El `if` puede empezar en una línea anterior: se sigue el paréntesis de su
 * condición y la guarda se resuelve cuando ese paréntesis se cierra.
 *
 * Para delimitar bloques se cuentan `{` y `}`, saltando los que aparecen dentro
 * de un literal de texto. Es una aproximación —un `{` dentro de una expresión
 * regular o un literal de plantilla a medias puede descolocar la pista—, pero
 * nunca exime fuera del bloque: el error cae del lado de avisar de más.
 *
 * Una guarda guardada en una variable (`const enNode = typeof window ===
 * 'undefined'`) no exime: el escáner no puede saber si luego se usa, así que la
 * decisión se ve en el mensaje en vez de silenciarse.
 *
 * Un identificador dentro de un literal con comillas simples o dobles no es un
 * uso: un fixture puede contener `document.body` sin ejecutarlo. Las plantillas
 * se siguen escaneando porque `${...}` sí contiene código.
 */
export function usosSinGuardar(fuente: string): Uso[] {
  const originales = fuente.split('\n');
  const lineas = sinComentarios(fuente).split('\n');

  /** Pila de bloques abiertos: el id de cada `{` permite comparar ámbitos. */
  const pila: number[] = [];
  let ultimoBloque = 0;
  /** Ámbitos donde ya se comprobó el entorno. */
  const guardas: string[] = [];
  /** Por cada `(` abierto, si es la condición de un `if` que puede empezar antes. */
  const parentesis: boolean[] = [];
  /** Guarda vista en una condición: se resuelve al cerrarse el paréntesis de su `if`. */
  let pendiente: { cierreEn: number; ambito: string; positivo: boolean } | null = null;
  /** La condición se cerró: el siguiente carácter decide qué protege la guarda. */
  let trasCondicion: string | null = null;
  /** El `{` que viene abre el bloque que protege la guarda pendiente. */
  let guardaAlAbrirBloque = false;

  const ambitoActual = () => `/${pila.join('/')}`;
  /**
   * Prefijo estricto: la guarda cubre su bloque y los de dentro, no los de
   * fuera. La del nivel superior (`/`) cubre el fichero entero, que es lo que
   * significa un `throw` inmediato: sin navegador el módulo no llega a cargarse.
   */
  const cubre = (ambitoGuarda: string, ambitoUso: string) =>
    ambitoGuarda === '/' ||
    ambitoUso === ambitoGuarda ||
    ambitoUso.startsWith(`${ambitoGuarda}/`);

  const salida: Uso[] = [];
  /** Delimitador del literal de texto en el que estamos, si estamos en uno. */
  let enCadena: string | null = null;

  lineas.forEach((linea, indice) => {
    const usos: Array<{ columna: number; nombre: string }> = [];
    for (const { nombre, patron } of PROHIBIDO) {
      patron.lastIndex = 0;
      let hallado: RegExpExecArray | null;
      while ((hallado = patron.exec(linea))) usos.push({ columna: hallado.index, nombre });
    }

    const guardasDeLinea: Array<{ columna: number; positivo: boolean }> = [];
    GUARDA.lastIndex = 0;
    let guarda: RegExpExecArray | null;
    while ((guarda = GUARDA.exec(linea))) {
      guardasDeLinea.push({ columna: guarda.index, positivo: guarda[1] === '!=' });
    }

    const eventos = [
      ...usos.map((uso) => ({
        tipo: 'uso' as const,
        columna: uso.columna,
        nombre: uso.nombre,
        positivo: false,
      })),
      ...guardasDeLinea.map(({ columna, positivo }) => ({
        tipo: 'guarda' as const,
        columna,
        nombre: '',
        positivo,
      })),
    ].sort((a, b) => a.columna - b.columna);

    let cursor = 0;
    const recorrer = (hasta: number) => {
      for (let i = cursor; i < hasta; i += 1) {
        const caracter = linea[i];
        if (enCadena) {
          if (caracter === '\\') i += 1;
          else if (caracter === enCadena) enCadena = null;
          continue;
        }
        if (/\s/.test(caracter)) continue;
        if (caracter === "'" || caracter === '"' || caracter === '`') {
          enCadena = caracter;
          continue;
        }

        // La condición del `if` se cerró: un `{` abre el bloque que la guarda
        // protege; cualquier otra cosa la deja cubriendo el resto del bloque.
        if (trasCondicion !== null) {
          if (caracter === '{') guardaAlAbrirBloque = true;
          else guardas.push(trasCondicion);
          trasCondicion = null;
        }

        if (caracter === '(') {
          // La condición puede estar partida en varias líneas, pero el `if (` se
          // escribe junto, así que basta mirar la línea actual.
          parentesis.push(/\bif\s*$/.test(linea.slice(0, i)));
        } else if (caracter === ')') {
          parentesis.pop();
          if (pendiente && parentesis.length === pendiente.cierreEn) {
            trasCondicion = pendiente.ambito;
            pendiente = null;
          }
        } else if (caracter === '{') {
          pila.push((ultimoBloque += 1));
          if (guardaAlAbrirBloque) {
            guardas.push(ambitoActual());
            guardaAlAbrirBloque = false;
          }
        } else if (caracter === '}') {
          pila.pop();
        }
      }
      cursor = Math.max(cursor, hasta);
    };

    for (const evento of eventos) {
      recorrer(evento.columna);

      // Un literal de texto no ejecuta nada: un fixture como
      // 'document.body...' no es un acceso al DOM. Las plantillas no se saltan
      // porque `${...}` sí contiene código.
      if (enCadena === "'" || enCadena === '"') continue;

      if (evento.tipo === 'guarda') {
        // Sólo la condición de un `if` delimita un bloque: una asignación no guarda nada.
        const indiceIf = parentesis.lastIndexOf(true);
        if (indiceIf === -1) continue;

        // Se resuelve al cerrarse el paréntesis de ese `if`, que puede estar
        // varias líneas más abajo.
        pendiente = { cierreEn: indiceIf, ambito: ambitoActual(), positivo: evento.positivo };
        continue;
      }

      const antes = linea.slice(0, evento.columna);
      // El global que va dentro del propio `typeof` no es un uso, se compare o no
      // contra `undefined` (`const enNode = typeof window === 'undefined'`).
      if (/\btypeof\s+$/.test(antes)) continue;

      if (GUARDA_EN_TEXTO.test(antes)) continue;

      // Operando de una condición partida en varias líneas, detrás de una
      // comprobación positiva: el `&&` evita evaluarlo si el global no existe.
      if (pendiente?.positivo && parentesis.length > pendiente.cierreEn) continue;

      if (guardas.some((ambitoGuarda) => cubre(ambitoGuarda, ambitoActual()))) continue;

      salida.push({
        linea: indice + 1,
        nombre: evento.nombre,
        texto: (originales[indice] ?? '').trim(),
      });
    }

    recorrer(linea.length);
  });

  return salida;
}

function ficherosFuente(carpeta: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...ficherosFuente(ruta));
    else if (EXTENSIONES.some((ext) => entrada.name.endsWith(ext))) salida.push(ruta);
  }
  return salida;
}

/**
 * Imports con valor de un fichero. Los de sólo tipo (`import type`, `export type`
 * y `import { type X }`) se borran al compilar y no cargan nada, así que no
 * cuentan como dependencia: seguirlos sólo produciría falsos positivos.
 */
function importsConValor(fuente: string): string[] {
  const especificadores: string[] = [];

  // La cláusula no puede cruzar comillas ni `;`: con `[\s\S]*?` un `export`
  // sin `from` hacía retroceder la búsqueda hasta el final del fichero.
  const conFrom = /(?:^|\n)\s*(?:import|export)\s+([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const coincide of fuente.matchAll(conFrom)) {
    const clausula = coincide[1].trim();
    if (clausula.startsWith('type ')) continue;
    const llaves = /^\{([\s\S]*)\}$/.exec(clausula);
    if (llaves && llaves[1].split(',').every((s) => s.trim() === '' || s.trim().startsWith('type '))) {
      continue;
    }
    especificadores.push(coincide[2]);
  }

  // Import de efecto secundario: `import './algo';`
  for (const coincide of fuente.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
    especificadores.push(coincide[1]);
  }

  return especificadores;
}

/**
 * Entradas de un directorio, listadas una sola vez.
 *
 * Resolver cada import con `existsSync` + `statSync` por candidato parecía
 * inocente, pero son ~1.200 llamadas síncronas al sistema de ficheros y en
 * Windows cuestan ~270 ms: casi todo el coste del guard. Listar los directorios
 * que los imports tocan de verdad son una docena de `readdirSync`.
 *
 * Recorrer el repo entero era peor: `src-tauri/target` acumula miles de
 * artefactos de compilación y ese paseo se iba a 1,4 s. Y una lista de carpetas
 * ignoradas siempre se queda corta.
 */
const listados = new Map<string, Set<string>>();
function entradasDe(carpeta: string): Set<string> {
  const cacheado = listados.get(carpeta);
  if (cacheado) return cacheado;

  let entradas: Set<string>;
  try {
    entradas = new Set(readdirSync(carpeta));
  } catch {
    // Un directorio que no existe no es un error: el import simplemente no resuelve.
    entradas = new Set();
  }
  listados.set(carpeta, entradas);
  return entradas;
}

/** Contenido leído una vez por fichero: el grafo y el escaneo leen los mismos tests. */
const contenidos = new Map<string, string>();
/** Lecturas de disco de verdad, no aciertos de caché: lo comprueba la prueba de presupuesto. */
let lecturasHechas = 0;
function leer(ruta: string): string {
  const cacheado = contenidos.get(ruta);
  if (cacheado !== undefined) return cacheado;
  lecturasHechas += 1;
  const texto = readFileSync(ruta, 'utf8');
  contenidos.set(ruta, texto);
  return texto;
}

/**
 * Resuelve un import a un fichero del repo. Los paquetes (incluidos `node:*`) no
 * se siguen: el DOM no entra por ahí salvo que se importe la librería a
 * propósito, y eso lo detecta el escaneo por líneas.
 */
function resolverImport(desde: string, especificador: string): string | null {
  if (!especificador.startsWith('.') && !especificador.startsWith('@/')) return null;

  // `@/*` está mapeado a la raíz en `tsconfig.json`.
  const base = especificador.startsWith('@/')
    ? path.join(RAIZ, especificador.slice(2))
    : path.resolve(path.dirname(desde), especificador);

  const carpeta = path.dirname(base);
  const nombre = path.basename(base);
  const candidatos: Array<[carpeta: string, archivo: string]> = [
    [carpeta, nombre],
    ...EXTENSIONES.map((ext) => [carpeta, nombre + ext] as [string, string]),
    ...EXTENSIONES.map((ext) => [base, `index${ext}`] as [string, string]),
  ];

  for (const [dir, archivo] of candidatos) {
    if (entradasDe(dir).has(archivo)) return path.join(dir, archivo);
  }
  return null;
}

/**
 * Recorre el grafo desde los tests de lógica y devuelve cada fichero alcanzado
 * con la cadena de imports que llevó hasta él (el primero que se encuentra, que
 * es el más corto porque el recorrido es por anchura).
 */
function alcanzadosDesdeTests(): Map<string, string[]> {
  const caminos = new Map<string, string[]>();
  const cola: Array<{ ruta: string; camino: string[] }> = [];

  for (const carpeta of CARPETAS) {
    for (const ruta of ficherosFuente(path.join(RAIZ, carpeta))) {
      if (ruta.endsWith('.test.ts')) cola.push({ ruta, camino: [rel(ruta)] });
    }
  }

  while (cola.length > 0) {
    const { ruta, camino } = cola.shift()!;
    if (caminos.has(ruta)) continue;
    caminos.set(ruta, camino);

    for (const especificador of importsConValor(sinComentarios(leer(ruta)))) {
      const destino = resolverImport(ruta, especificador);
      if (destino && !caminos.has(destino)) {
        cola.push({ ruta: destino, camino: [...camino, rel(destino)] });
      }
    }
  }

  return caminos;
}

/**
 * Presupuesto de tiempo del grafo.
 *
 * Todo esto es texto de ~150 KB: la medición local es de ~90 ms con 24 ficheros y
 * 13 módulos, así que 1 s deja un margen de ~10x para no fallar por carga del
 * runner y sigue sobrando para cazar lo que ya pasó una vez: recorrer el repo
 * entero se iba a 1,4 s (`src-tauri/target` tiene miles de artefactos) y volver
 * a un `statSync` por candidato, a ~450 ms.
 *
 * Si la máquina es más lenta, sube la constante con la medición que lo
 * justifique. No bajes el margen ni cambies la medición por una en caliente.
 */
const PRESUPUESTO_MS = 1000;

describe('separación de proyectos de Vitest', () => {
  test('el proyecto `node` corre sin jsdom', () => {
    // No usa `typeof window` para no depender de que `lib` declare el DOM.
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
  });

  test('tests/unit y tests/mcp no tocan el DOM', () => {
    const infractores: string[] = [];
    let escaneados = 0;

    for (const carpeta of CARPETAS) {
      const ficheros = ficherosFuente(path.join(RAIZ, carpeta));
      // Una carpeta mal escrita (o movida) dejaría el guard pasando por vacío.
      expect(ficheros.length, `no se encontraron ficheros en ${carpeta}`).toBeGreaterThan(0);

      for (const ruta of ficheros) {
        if (ruta === ESTE_FICHERO) continue;
        escaneados += 1;
        for (const uso of usosSinGuardar(leer(ruta))) {
          infractores.push(`${rel(ruta)}:${uso.linea} usa ${uso.nombre} → ${uso.texto}`);
        }
      }
    }

    expect(escaneados).toBeGreaterThan(0);
    expect(
      infractores,
      'estos ficheros corren en entorno `node`: mueve el test a tests/ui en vez de añadir polyfills',
    ).toEqual([]);
  });

  test('los tests de lógica no arrastran módulos que usen el DOM', () => {
    const caminos = alcanzadosDesdeTests();
    const modulos = [...caminos].filter(
      ([ruta]) => !ruta.endsWith('.test.ts') && ruta !== ESTE_FICHERO,
    );

    // Si el resolvedor dejara de seguir imports, este test pasaría sin mirar nada.
    expect(modulos.length, 'no se alcanzó ningún módulo desde los tests').toBeGreaterThan(0);

    const infractores: string[] = [];
    for (const [ruta, camino] of modulos) {
      for (const uso of usosSinGuardar(leer(ruta))) {
        infractores.push(
          `${rel(ruta)}:${uso.linea} usa ${uso.nombre} → ${uso.texto}\n` +
            `    llega desde: ${camino.join(' → ')}`,
        );
      }
    }

    expect(
      infractores,
      'un test de lógica importa un módulo que necesita el DOM: el test va a tests/ui o el módulo se parte en una parte pura y otra de navegador',
    ).toEqual([]);
  });

  test('el grafo se resuelve sin pasear el repo y dentro del presupuesto', () => {
    // En frío: con todo memorizado no se mediría nada.
    listados.clear();
    contenidos.clear();
    const lecturasAntes = lecturasHechas;

    const inicio = performance.now();
    const caminos = alcanzadosDesdeTests();
    const modulos = [...caminos].filter(
      ([ruta]) => !ruta.endsWith('.test.ts') && ruta !== ESTE_FICHERO,
    );
    for (const [ruta] of modulos) usosSinGuardar(leer(ruta));
    const ms = performance.now() - inicio;

    // Una lectura por fichero alcanzado: sin caché, el grafo y el escaneo leían
    // dos veces lo mismo.
    expect(lecturasHechas - lecturasAntes).toBe(caminos.size);

    // Ni siquiera se lista un directorio por fichero. Recorrer el repo entero
    // significaba cientos de `readdirSync` y era lo que lo llevaba a 1,4 s.
    expect(listados.size).toBeLessThanOrEqual(caminos.size);

    // Y la resolución tiene que seguir usando listados: volver a preguntar al
    // disco fichero por fichero (`existsSync`/`statSync` por candidato) no baja
    // del presupuesto por sí sola, pero es el regreso que se quiere ver.
    expect(
      listados.size,
      'la resolución de imports no listó ningún directorio: ¿volvió a `existsSync`/`statSync` por candidato?',
    ).toBeGreaterThan(0);

    expect(
      ms,
      `el grafo tardó ${ms.toFixed(0)} ms con ${caminos.size} ficheros (presupuesto ${PRESUPUESTO_MS} ms)`,
    ).toBeLessThan(PRESUPUESTO_MS);
  });
});

/**
 * Casos fijados del escáner: qué guardas eximen y cuáles no.
 *
 * Sin esto, las exenciones sólo estaban comprobadas a mano con ficheros
 * temporales, y un cambio en el escáner podía volverlas más laxas —o romperlas—
 * sin que nada se pusiera rojo. Las tres primeras pruebas definen qué **sí** se
 * exime; las demás, qué no, que es lo que mantiene el guard con sentido.
 */
describe('usosSinGuardar', () => {
  /** Resumen legible: `nombre · línea`, para comparar de un vistazo. */
  const usos = (fuente: string) =>
    usosSinGuardar(fuente).map((uso) => `${uso.nombre} · ${uso.texto}`);

  test('una guarda anterior cubre el resto de su bloque', () => {
    const fuente = `export function leer() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('x');
}`;
    expect(usos(fuente)).toEqual([]);
  });

  test('un `if` con bloque cubre lo que hay dentro', () => {
    const fuente = `export function ancho() {
  if (typeof window !== 'undefined') {
    return window.innerWidth;
  }
  return 0;
}`;
    expect(usos(fuente)).toEqual([]);
  });

  test('la guarda de la misma línea cubre el uso de después', () => {
    const fuente = `export const hay = typeof window !== 'undefined' && window.localStorage.length > 0;
export const tipo = typeof document;`;
    expect(usos(fuente)).toEqual([]);
  });

  test('al cerrar el bloque, la guarda deja de cubrir', () => {
    const fuente = `export function mover() {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('a', 'b');
  }
  return localStorage.getItem('c');
}`;
    expect(usos(fuente)).toEqual(["localStorage · return localStorage.getItem('c');"]);
  });

  test('una guarda en el nivel superior cubre el módulo entero', () => {
    const fuente = `if (typeof window === 'undefined') throw new Error('sólo navegador');

export function ancho() {
  return window.innerWidth;
}`;
    expect(usos(fuente)).toEqual([]);
  });

  test('la guarda de una función no cubre otra', () => {
    const fuente = `function auxiliar() {
  if (typeof window === 'undefined') return 0;
  return 1;
}

export function otra() {
  return window.innerHeight + auxiliar();
}`;
    expect(usos(fuente)).toEqual(['window · return window.innerHeight + auxiliar();']);
  });

  test('una guarda guardada en una variable no exime', () => {
    const fuente = `const enNode = typeof window === 'undefined';

export function scroll() {
  if (enNode) return 0;
  return window.scrollY;
}`;
    expect(usos(fuente)).toEqual(['window · return window.scrollY;']);
  });

  test('la guarda de después no exime el uso de antes', () => {
    const fuente = `const titulo = document.title;
if (typeof document === 'undefined') throw new Error('sin DOM');`;
    expect(usos(fuente)).toEqual(['document · const titulo = document.title;']);
  });

  test('sin guarda se marca, con el número de línea real', () => {
    const usosCrudos = usosSinGuardar('const titulo = document.title;');
    expect(usosCrudos).toEqual([
      { linea: 1, nombre: 'document', texto: 'const titulo = document.title;' },
    ]);
  });

  test('un comentario no es un uso', () => {
    const fuente = `// Aquí hablábamos de window y de document sin tocarlos.
export const nada = 1;`;
    expect(usos(fuente)).toEqual([]);
  });

  test('un literal de texto no es un uso, pero el código real sí', () => {
    const fuente = `const fixture = 'document.body.dataset.publicado = "si";';
export const real = document.title;`;
    expect(usos(fuente)).toEqual(['document · export const real = document.title;']);
  });

  test('cerrar un literal devuelve el escáner al código de la línea', () => {
    const fuente = `const fixture = 'document.title'; const real = window.location.href;`;
    expect(usos(fuente)).toEqual([`window · ${fuente}`]);
  });

  test('una guarda con la condición partida en varias líneas cubre lo de después', () => {
    const fuente = `export function leer() {
  if (
    typeof window === 'undefined'
  ) return null;
  return window.localStorage.getItem('x');
}`;
    expect(usos(fuente)).toEqual([]);
  });

  test('una guarda multilínea que abre bloque deja de cubrir al cerrarlo', () => {
    const fuente = `export function mover() {
  if (
    typeof window !== 'undefined'
  ) {
    sessionStorage.setItem('a', 'b');
  }
  return localStorage.getItem('c');
}`;
    expect(usos(fuente)).toEqual(["localStorage · return localStorage.getItem('c');"]);
  });

  test('el operando de la condición tras una comprobación positiva no se marca', () => {
    const fuente = `export function href() {
  if (
    typeof window !== 'undefined' &&
    window.location.href
  ) return 1;
  return 0;
}`;
    expect(usos(fuente)).toEqual([]);
  });

  test('con la comprobación negativa, el operando de la condición sí se marca', () => {
    const fuente = `export function raro() {
  if (
    typeof window === 'undefined' ||
    window.location.href
  ) return 1;
  return 0;
}`;
    expect(usos(fuente)).toEqual(['window · window.location.href']);
  });
});
