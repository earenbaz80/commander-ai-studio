import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { executeAgentTool } from '../agentTools.js';
import { shutdownBrowser } from '../browserSession.js';
import { addRoot } from '../projects.js';

/**
 * Tres bugs visuales reproducidos en un Chromium real, más un control oculto.
 *
 * No hay VLM ni comparación de píxeles: el snapshot debe resolverlos con los
 * metadatos del DOM. El fixture es una página normal servida por HTTP; los
 * defectos son los mismos que se ven en una app (texto ilegible, contenido
 * recortado y un CTA fuera del viewport).
 */

interface LocalFixture {
  baseUrl: string;
  close: () => Promise<void>;
}

const HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Bugs visuales</title>
    <style>
      body { margin: 0; padding: 24px; background: #fff; color: #111; font: 16px/1.4 system-ui, sans-serif; }
      h1 { margin: 0 0 24px; font-size: 24px; }
      .row { position: relative; margin: 0 0 20px; }
      #low-contrast { color: #777; background: #888; border: 0; padding: 8px 12px; font-size: 14px; }
      #clipped { display: block; width: 86px; padding: 8px; overflow: hidden; white-space: nowrap; font-size: 14px; }
      #offscreen { position: absolute; left: -360px; top: 0; padding: 10px; background: #ffff55; color: #000080; }
      #hidden-control { display: none; visibility: hidden; }
    </style>
  </head>
  <body>
    <h1>Bugs visuales</h1>
    <div class="row"><button id="low-contrast">Estado del pedido</button></div>
    <div class="row"><button id="clipped">Confirmar compra</button></div>
    <div class="row"><a id="offscreen" href="#comprar">Comprar ahora</a></div>
    <button id="hidden-control">Guardar borrador</button>
  </body>
</html>`;

async function startFixture(): Promise<LocalFixture> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(HTML);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

const lineFor = (snapshot: string, name: string): string => {
  const line = snapshot.split('\n').find((candidate) => candidate.includes(`"${name}"`));
  assert.ok(line, `el snapshot no contiene "${name}":\n${snapshot}`);
  return line;
};

const numberAttr = (line: string, name: string): number => {
  const match = new RegExp(`${name}=(-?[\\d.]+)`).exec(line);
  assert.ok(match, `falta ${name} en la línea: ${line}`);
  return Number(match[1]);
};

test('browser snapshot: resuelve 3 bugs visuales reales sin VLM', async (t) => {
  const fixture = await startFixture();
  const testRoot = fs.mkdtempSync(path.join(process.cwd(), 'tests', 'tmp-browser-visual-'));
  addRoot(testRoot);
  let sessionId = '';

  try {
    const opened = await executeAgentTool('browser', {
      root: testRoot,
      action: 'open',
      url: fixture.baseUrl,
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.ok((opened as any).data?.sessionId, 'open debe devolver una sesión');
    sessionId = (opened as any).data.sessionId;

    const result = await executeAgentTool('browser', {
      root: testRoot,
      action: 'snapshot',
      sessionId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const snapshot = String((result as any).data?.text || '');
    assert.ok(snapshot.length > 0, 'el snapshot no puede venir vacío');
    assert.match(snapshot, /viewport=1280x800/, 'la caja necesita una referencia de viewport');

    const lowContrast = lineFor(snapshot, 'Estado del pedido');
    assert.match(lowContrast, /box=/, 'todo nodo debe traer caja');
    const contrast = numberAttr(lowContrast, 'contrast');
    const contrastMin = Number(/contrast=[\d.]+\/([\d.]+)/.exec(lowContrast)?.[1]);
    assert.ok(Number.isFinite(contrastMin), `falta el mínimo de contraste: ${lowContrast}`);
    assert.ok(contrast < contrastMin, `el texto debería marcarse ilegible: ${lowContrast}`);

    const clipped = lineFor(snapshot, 'Confirmar compra');
    assert.match(clipped, /box=/, 'el nodo recortado debe traer caja');
    assert.match(clipped, /overflow=[^ ]*clip:x/, `el recorte horizontal no se detectó: ${clipped}`);

    const offscreen = lineFor(snapshot, 'Comprar ahora');
    const boxMatch = /box=(-?[\d.]+),(-?[\d.]+),([\d.]+)x([\d.]+)/.exec(offscreen);
    assert.ok(boxMatch, `el CTA debería traer caja: ${offscreen}`);
    assert.ok(Number(boxMatch[1]) < 0, `el CTA fuera de pantalla debería tener x negativa: ${offscreen}`);

    const hidden = lineFor(snapshot, 'Guardar borrador');
    assert.match(hidden, /display=none/, `display no se expuso: ${hidden}`);
    assert.match(hidden, /visibility=hidden/, `visibility no se expuso: ${hidden}`);
    assert.match(hidden, /\bhidden\b/, `el nodo no se marcó como no accionable: ${hidden}`);

    // Los tres bugs de la prueba quedan resueltos sin mirar un píxel; el
    // control oculto se reporta aparte porque no se usa para el recuento.
    const detected = [contrast < contrastMin, /clip:x/.test(clipped), Number(boxMatch[1]) < 0]
      .filter(Boolean).length;
    t.diagnostic(
      `sin VLM: ${detected}/3 · contraste ${contrast}/${contrastMin} · overflow clip:x · CTA x=${boxMatch[1]} · hidden control detectado`,
    );
    assert.equal(detected, 3);
  } finally {
    if (sessionId) {
      await executeAgentTool('browser', { root: testRoot, action: 'close', sessionId });
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
    await fixture.close();
    // El driver directo comparte un Chromium perezoso: cerrar la sesión no
    // termina el proceso. Sin esto el runner de node:test se queda vivo.
    await shutdownBrowser();
  }
});
