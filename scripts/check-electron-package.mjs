/**
 * Guardia del paquete de Electron.
 *
 * `electron-builder --dir` en verde sólo dice que el pipeline terminó: la
 * rotura que nadie vio fue un paquete que se generaba igual pero sin `node-pty`
 * (el módulo nativo se resuelve desde `extraResources`, no desde el asar) o sin
 * el `server.cjs` que arranca el backend. Este script mira el resultado, no el
 * log: exige las dos piezas y un binario nativo dentro de node-pty.
 *
 * Uso: `node scripts/check-electron-package.mjs [dir de la app]`
 *      (por defecto `release/win-unpacked`, el `appOutDir` de este repo)
 */
import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(process.argv[2] ?? path.join('release', 'win-unpacked'));
const recursos = path.join(appDir, 'resources');

const fallos = [];
const exigir = (ruta, descripcion) => {
  if (!fs.existsSync(ruta)) fallos.push(`${descripcion}: falta ${path.relative(process.cwd(), ruta) || ruta}`);
};

if (!fs.existsSync(appDir)) {
  console.error(`[check:electron-package] no existe el paquete: ${appDir}`);
  console.error('[check:electron-package] ¿corriste `npm run build:electron -- --dir`?');
  process.exit(1);
}

// 1) Las dos piezas que viajan en `extraResources` y sin las cuales la app
//    arranca pero el backend (terminal, server) no existe.
const server = path.join(recursos, 'server.cjs');
const pty = path.join(recursos, 'node_modules', 'node-pty');
exigir(server, 'server.cjs del backend');
exigir(path.join(pty, 'package.json'), 'node-pty en extraResources');

// 2) Copiar la carpeta no alcanza: sin el .node binario node-pty importa pero
//    falla al abrir una terminal. Se acepta cualquiera de los dos layouts
//    (prebuild o compilación local).
const binarios = [];
const recorrer = (dir, profundidad) => {
  if (profundidad > 4 || !fs.existsSync(dir)) return;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) recorrer(ruta, profundidad + 1);
    else if (entrada.name.endsWith('.node')) binarios.push(ruta);
  }
};
recorrer(pty, 0);
if (binarios.length === 0 && fs.existsSync(pty)) {
  fallos.push(`node-pty está copiado pero sin ningún .node (${path.relative(process.cwd(), pty)})`);
}

// 3) El asar tiene que existir: si falta, electron-builder empaquetó otra cosa.
exigir(path.join(recursos, 'app.asar'), 'app.asar');

if (fallos.length > 0) {
  console.error('[check:electron-package] el paquete está incompleto:');
  for (const fallo of fallos) console.error(`  · ${fallo}`);
  process.exitCode = 1;
} else {
  const version = JSON.parse(fs.readFileSync(path.join(pty, 'package.json'), 'utf8')).version;
  const tam = (ruta) => `${Math.round(fs.statSync(ruta).size / 1024)} KB`;
  console.log(
    `[check:electron-package] ok · ${path.relative(process.cwd(), appDir)} · ` +
      `server.cjs ${tam(server)} · node-pty ${version} con ${binarios.length} binario(s) nativo(s) · ` +
      `app.asar ${tam(path.join(recursos, 'app.asar'))}`
  );
}
