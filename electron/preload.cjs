// Preload script for Commander AI Studio
// Exposes safe IPC APIs to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // App info
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
  },

  // Auto-updater
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
    onUpdateAvailable: (callback) => {
      const handler = (_event, info) => callback(info);
      window.electronAPI?.update?.onUpdateAvailable?.(callback);
      // Using native event listener
      window.electronAPI = window.electronAPI || {};
      window.electronAPI.update = window.electronAPI.update || {};
      window.electronAPI.update.onUpdateAvailable = callback;
      // Also expose via direct listener
      ipcRenderer.on('update-available', (_event, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('update-available');
    },
    onUpdateDownloaded: (callback) => {
      ipcRenderer.on('update-downloaded', (_event, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('update-downloaded');
    },
    onDownloadProgress: (callback) => {
      ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress));
      return () => ipcRenderer.removeAllListeners('update-download-progress');
    },
    check: () => window.electronAPI.update?.check?.() || ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
  },

  // OAuth
  oauth: {
    login: (provider) => window.open(`/auth/${provider}`, '_blank', 'width=600,height=700'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getCurrentUser: () => ipcRenderer.invoke('auth:me'),
  },

  // Fallback router
  fallback: {
    generate: (params) => ipcRenderer.invoke('fallback:generate', params),
    getMetrics: () => ipcRenderer.invoke('fallback:getMetrics'),
    checkHealth: () => ipcRenderer.invoke('fallback:health'),
    resetCircuit: (providerId) => ipcRenderer.invoke('fallback:resetCircuit', providerId),
    setProviderEnabled: (providerId, enabled) => ipcRenderer.invoke('fallback:setProviderEnabled', providerId, enabled),
  },

  // LSP (TypeScript Language Server)
  lsp: {
    initialize: (projectRoot) => ipcRenderer.invoke('lsp:initialize', projectRoot),
    shutdown: () => ipcRenderer.invoke('lsp:shutdown'),
    didOpen: (params) => ipcRenderer.invoke('lsp:didOpen', params),
    didChange: (params) => ipcRenderer.invoke('lsp:didChange', params),
    didClose: (params) => ipcRenderer.invoke('lsp:didClose', params),
    hover: (params) => ipcRenderer.invoke('lsp:hover', params),
    definition: (params) => ipcRenderer.invoke('lsp:definition', params),
    completion: (params) => ipcRenderer.invoke('lsp:completion', params),
    rename: (params) => ipcRenderer.invoke('lsp:rename', params),
    references: (params) => ipcRenderer.invoke('lsp:references', params),
    documentSymbols: (params) => ipcRenderer.invoke('lsp:documentSymbols', params),
    workspaceSymbols: (params) => ipcRenderer.invoke('lsp:workspaceSymbols', params),
    onDiagnostics: (callback) => {
      const listener = (_event, params) => callback(params);
      ipcRenderer.on('lsp:diagnostics', listener);
      return () => ipcRenderer.removeListener('lsp:diagnostics', listener);
    },
  },

  // Platform info. `app` no existe en un preload sandbox: para saber si la app
  // está empaquetada se consulta `app:getInfo` por IPC.
  platform: process.platform,
});

console.log('[Preload] electronAPI exposed to renderer');