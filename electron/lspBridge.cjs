/**
 * LSP Bridge for TypeScript Language Server
 * Runs in Electron Main Process, exposes JSON-RPC via IPC to renderer
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const lspClients = new Map(); // webContentsId -> { process, pendingRequests, requestId }

/**
 * Resuelve cómo lanzar `typescript-language-server` de forma multiplataforma.
 * Preferimos ejecutar `lib/cli.mjs` con el binario actual en modo Node
 * (`ELECTRON_RUN_AS_NODE`), que funciona en Windows sin depender de shims.
 */
function resolveLspLaunch(projectRoot) {
  const isWin = process.platform === 'win32';
  const scriptCandidates = [
    path.join(projectRoot, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'),
    path.join(__dirname, '..', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'),
  ];
  for (const script of scriptCandidates) {
    if (fs.existsSync(script)) {
      return {
        command: process.execPath,
        args: [script, '--stdio'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'development' },
        shell: false,
      };
    }
  }

  const binName = isWin ? 'typescript-language-server.cmd' : 'typescript-language-server';
  const binCandidates = [
    path.join(projectRoot, 'node_modules', '.bin', binName),
    path.join(__dirname, '..', 'node_modules', '.bin', binName),
  ];
  for (const bin of binCandidates) {
    if (fs.existsSync(bin)) {
      return {
        command: bin,
        args: ['--stdio'],
        env: { ...process.env, NODE_ENV: 'development' },
        shell: isWin,
      };
    }
  }

  // Último recurso: confiar en que esté en el PATH.
  return {
    command: 'typescript-language-server',
    args: ['--stdio'],
    env: { ...process.env, NODE_ENV: 'development' },
    shell: isWin,
  };
}

/**
 * Spawn TypeScript Language Server and set up JSON-RPC communication
 */
function spawnTypeScriptLSP(webContentsId, projectRoot) {
  const launch = resolveLspLaunch(projectRoot);

  const lspProcess = spawn(launch.command, launch.args, {
    cwd: projectRoot,
    env: launch.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: launch.shell,
  });

  const client = {
    process: lspProcess,
    pendingRequests: new Map(), // id -> { resolve, reject }
    requestId: 1,
    initialized: false,
    projectRoot,
  };

  lspClients.set(webContentsId, client);

  // Buffer for incomplete messages
  let buffer = '';

  // Handle stdout - parse JSON-RPC messages
  lspProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    
    // Process complete messages (separated by \r\n\r\n for headers + content)
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      
      const headers = buffer.slice(0, headerEnd);
      const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      
      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      
      if (buffer.length < messageStart + contentLength) break;
      
      const content = buffer.slice(messageStart, messageStart + contentLength);
      buffer = buffer.slice(messageStart + contentLength);
      
      try {
        const message = JSON.parse(content);
        handleLSPMessage(webContentsId, message);
      } catch (e) {
        console.error('[LSP] Failed to parse message:', e);
      }
    }
  });

  lspProcess.stderr.on('data', (data) => {
    console.error('[LSP stderr]', data.toString());
  });

  const rejectAllPending = (err) => {
    for (const { reject } of client.pendingRequests.values()) {
      try {
        reject(err);
      } catch {
        /* noop */
      }
    }
    client.pendingRequests.clear();
  };

  // Evita que un EPIPE (servidor no instalado / cerrado) tumbe el proceso main.
  lspProcess.stdin.on('error', (err) => {
    console.error('[LSP] stdin error:', err && err.message ? err.message : err);
    rejectAllPending(err instanceof Error ? err : new Error(String(err)));
  });

  lspProcess.on('exit', (code) => {
    console.log('[LSP] Process exited with code', code);
    rejectAllPending(new Error(`LSP process exited with code ${code}`));
    lspClients.delete(webContentsId);
  });

  lspProcess.on('error', (err) => {
    console.error('[LSP] Process error:', err);
    rejectAllPending(err);
    lspClients.delete(webContentsId);
  });

  // Handshake: mandamos `initialize` y resolvemos la promesa cuando el
  // servidor responde, para que el renderer no envíe `didOpen` antes de tiempo.
  return sendLSPRequest(webContentsId, 'initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(projectRoot).href,
    capabilities: {
      textDocument: {
        // typescript-language-server 6 sólo publica diagnósticos si el cliente
        // declara esta capacidad (la usa para decidir `diagnosticsSupport`).
        publishDiagnostics: { relatedInformation: true, versionSupport: false },
        hover: { dynamicRegistration: false },
        definition: { dynamicRegistration: false },
        completion: { dynamicRegistration: false, completionItem: { snippetSupport: true } },
        rename: { dynamicRegistration: false },
        references: { dynamicRegistration: false },
        documentSymbol: { dynamicRegistration: false },
        synchronization: { dynamicRegistration: false },
      },
      workspace: {
        didChangeConfiguration: { dynamicRegistration: false },
        configuration: true,
        symbol: { dynamicRegistration: false },
      },
    },
    trace: 'off',
  })
    .then((result) => {
      client.initialized = true;
      // Send initialized notification
      sendLSPNotification(webContentsId, 'initialized', {});
      console.log('[LSP] Initialized for project:', projectRoot);
      return { success: true, capabilities: result ? result.capabilities : undefined };
    })
    .catch((err) => {
      console.error('[LSP] Initialize failed:', err);
      throw err;
    });
}

/**
 * Handle incoming LSP message (response or notification)
 */
function handleLSPMessage(webContentsId, message) {
  const client = lspClients.get(webContentsId);
  if (!client) return;

  // Response to a request
  if (message.id !== undefined && client.pendingRequests.has(message.id)) {
    const { resolve, reject } = client.pendingRequests.get(message.id);
    client.pendingRequests.delete(message.id);
    
    if (message.error) {
      reject(new Error(message.error.message || 'LSP error'));
    } else {
      resolve(message.result);
    }
    return;
  }

  // Notification from server (e.g., publishDiagnostics)
  if (message.method === 'textDocument/publishDiagnostics') {
    // Forward diagnostics to renderer (guard: no `electron` outside Electron).
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(webContentsId);
      if (wc && !wc.isDestroyed()) {
        wc.send('lsp:diagnostics', message.params);
      }
    } catch (e) {
      console.error('[LSP] No se pudo reenviar diagnósticos:', e && e.message ? e.message : e);
    }
    return;
  }

  // Request from the server → respond so the server does not block.
  if (message.method && message.id !== undefined) {
    let result = null;
    if (message.method === 'workspace/configuration') {
      const items = (message.params && message.params.items) || [];
      result = items.map(() => ({}));
    } else if (
      message.method === 'window/showMessageRequest' ||
      message.method === 'client/registerCapability' ||
      message.method === 'client/unregisterCapability'
    ) {
      result = null;
    }
    sendLSPResponse(webContentsId, message.id, result);
  }
}

/**
 * Send JSON-RPC request to LSP
 */
function sendLSPRequest(webContentsId, method, params) {
  const client = lspClients.get(webContentsId);
  if (!client) return Promise.reject(new Error('LSP client not found'));

  const id = client.requestId++;
  const message = { jsonrpc: '2.0', id, method, params };

  return new Promise((resolve, reject) => {
    client.pendingRequests.set(id, { resolve, reject });
    
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    
    try {
      client.process.stdin.write(header + content);
    } catch (e) {
      client.pendingRequests.delete(id);
      reject(e);
    }
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (client.pendingRequests.has(id)) {
        client.pendingRequests.delete(id);
        reject(new Error('LSP request timeout'));
      }
    }, 30000);
  });
}

/**
 * Send JSON-RPC notification to LSP (no response expected)
 */
function sendLSPNotification(webContentsId, method, params) {
  const client = lspClients.get(webContentsId);
  if (!client) return;

  const message = { jsonrpc: '2.0', method, params };
  const content = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
  
  try {
    client.process.stdin.write(header + content);
  } catch (e) {
    console.error('[LSP] Failed to send notification:', e);
  }
}

/**
 * Send a JSON-RPC response back to the LSP server (for server-initiated requests)
 */
function sendLSPResponse(webContentsId, id, result) {
  const client = lspClients.get(webContentsId);
  if (!client) return;

  const message = { jsonrpc: '2.0', id, result };
  const content = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

  try {
    client.process.stdin.write(header + content);
  } catch (e) {
    console.error('[LSP] Failed to send response:', e);
  }
}

/**
 * Send didOpen notification for a file
 */
function notifyDidOpen(webContentsId, filePath, languageId, version, text) {
  const uri = pathToFileURL(filePath).href;
  sendLSPNotification(webContentsId, 'textDocument/didOpen', {
    textDocument: { uri, languageId, version, text },
  });
}

/**
 * Send didChange notification for a file
 */
function notifyDidChange(webContentsId, filePath, version, changes) {
  const uri = pathToFileURL(filePath).href;
  sendLSPNotification(webContentsId, 'textDocument/didChange', {
    textDocument: { uri, version },
    contentChanges: changes,
  });
}

/**
 * Send didClose notification for a file
 */
function notifyDidClose(webContentsId, filePath) {
  const uri = pathToFileURL(filePath).href;
  sendLSPNotification(webContentsId, 'textDocument/didClose', {
    textDocument: { uri },
  });
}

/**
 * Request hover info
 */
function requestHover(webContentsId, filePath, line, character) {
  const uri = pathToFileURL(filePath).href;
  return sendLSPRequest(webContentsId, 'textDocument/hover', {
    textDocument: { uri },
    position: { line, character },
  });
}

/**
 * Request go-to-definition
 */
function requestDefinition(webContentsId, filePath, line, character) {
  const uri = pathToFileURL(filePath).href;
  return sendLSPRequest(webContentsId, 'textDocument/definition', {
    textDocument: { uri },
    position: { line, character },
  });
}

/**
 * Request completions
 */
function requestCompletion(webContentsId, filePath, line, character, triggerKind = 1) {
  const uri = pathToFileURL(filePath).href;
  return sendLSPRequest(webContentsId, 'textDocument/completion', {
    textDocument: { uri },
    position: { line, character },
    context: { triggerKind },
  });
}

/**
 * Request rename
 */
function requestRename(webContentsId, filePath, line, character, newName) {
  const uri = pathToFileURL(filePath).href;
  return sendLSPRequest(webContentsId, 'textDocument/rename', {
    textDocument: { uri },
    position: { line, character },
    newName,
  });
}

/**
 * Request references
 */
function requestReferences(webContentsId, filePath, line, character, includeDeclaration = true) {
  const uri = pathToFileURL(filePath).href;
  return sendLSPRequest(webContentsId, 'textDocument/references', {
    textDocument: { uri },
    position: { line, character },
    context: { includeDeclaration },
  });
}

/**
 * Request document symbols
 */
function requestDocumentSymbols(webContentsId, filePath) {
  const uri = pathToFileURL(filePath).href;
  return sendLSPRequest(webContentsId, 'textDocument/documentSymbol', {
    textDocument: { uri },
  });
}

/**
 * Request workspace-wide symbols (workspace/symbol)
 */
function requestWorkspaceSymbols(webContentsId, query) {
  return sendLSPRequest(webContentsId, 'workspace/symbol', { query: query || '' });
}

/**
 * Shutdown LSP for a webContents
 */
function shutdownLSP(webContentsId) {
  const client = lspClients.get(webContentsId);
  if (!client) return;

  sendLSPRequest(webContentsId, 'shutdown', {}).then(() => {
    sendLSPNotification(webContentsId, 'exit', {});
    client.process.kill();
    lspClients.delete(webContentsId);
  }).catch(() => {
    client.process.kill();
    lspClients.delete(webContentsId);
  });
}

module.exports = {
  spawnTypeScriptLSP,
  shutdownLSP,
  notifyDidOpen,
  notifyDidChange,
  notifyDidClose,
  requestHover,
  requestDefinition,
  requestCompletion,
  requestRename,
  requestReferences,
  requestDocumentSymbols,
  requestWorkspaceSymbols,
};