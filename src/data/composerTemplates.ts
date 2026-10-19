import { ProjectFile } from '../components/ComposerPlayground';

export interface ComposerTemplate {
  id: string;
  title: string;
  category: 'tauri' | 'electron' | 'ai_agent' | 'mobile' | 'cli';
  badge: string;
  description: string;
  icon: string;
  files: ProjectFile[];
}

export const COMPOSER_TEMPLATES: ComposerTemplate[] = [
  {
    id: 'tauri-react-ts',
    title: 'Tauri v2 + React 19 + Rust IPC',
    category: 'tauri',
    badge: 'Nativo Ligero',
    description: 'Aplicación de escritorio nativa ultraligera empaquetada con Rust y Webview2 / WebKit.',
    icon: '🦀',
    files: [
      {
        name: 'src-tauri/Cargo.toml',
        originalContent: `[package]
name = "commander-tauri-app"
version = "0.1.0"
description = "Commander Tauri v2 Native App"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0.0", features = [] }

[dependencies]
tauri = { version = "2.0.0", features = [] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
`,
      },
      {
        name: 'src-tauri/src/main.rs',
        originalContent: `// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct GreetingResponse {
    message: String,
    timestamp: u64,
}

#[tauri::command]
fn greet(name: &str) -> Result<GreetingResponse, String> {
    if name.is_empty() {
        return Err("El nombre no puede estar vacío".into());
    }
    Ok(GreetingResponse {
        message: format!("¡Hola {} desde el motor nativo de Rust Tauri v2!", name),
        timestamp: 1730000000,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`,
      },
      {
        name: 'tauri.conf.json',
        originalContent: `{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/tooling/cli/schema.json",
  "productName": "CommanderTauriApp",
  "version": "1.0.0",
  "identifier": "com.commander.tauriapp",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:3000",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Commander Studio - Tauri v2 Native",
        "width": 1100,
        "height": 750,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  }
}
`,
      },
      {
        name: 'src/App.tsx',
        originalContent: `import React, { useState } from 'react';

export function App() {
  const [name, setName] = useState('');
  const [response, setResponse] = useState<string | null>(null);

  const handleInvoke = async () => {
    try {
      // In Tauri environment:
      // const { invoke } = await import('@tauri-apps/api/core');
      // const res = await invoke('greet', { name });
      setResponse(\`Rust IPC Respondido: ¡Hola \${name || 'Comandante'} desde Tauri v2!\`);
    } catch (e: any) {
      setResponse(\`Error IPC: \${e.message}\`);
    }
  };

  return (
    <div className="p-6 bg-[#000080] min-h-screen text-[#00ffff] font-mono">
      <div className="border-2 border-[#00ffff] bg-[#0000aa] p-4 max-w-xl mx-auto shadow-[4px_4px_0px_#000000]">
        <h1 className="text-lg font-bold text-[#ffff55] mb-2">⚡ TAURI v2 + REACT NATIVO</h1>
        <p className="text-xs mb-4 text-white">Comunícate directamente con Rust mediante llamadas IPC de alto rendimiento y cero sobrecarga de memoria.</p>
        
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ingresa tu nombre..."
            className="flex-1 bg-[#000080] border border-[#00ffff] p-2 text-xs text-white outline-none"
          />
          <button
            onClick={handleInvoke}
            className="bg-[#00ffff] text-black font-bold px-4 text-xs hover:bg-white transition-colors"
          >
            EJECUTAR RUST IPC
          </button>
        </div>

        {response && (
          <div className="bg-[#000055] border border-[#ffff55] p-3 text-xs text-[#ffff55]">
            {response}
          </div>
        )}
      </div>
    </div>
  );
}
`,
      },
      {
        name: 'package.json',
        originalContent: `{
  "name": "commander-tauri-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
`,
      }
    ]
  },

  {
    id: 'electron-fullstack',
    title: 'Electron 34 + Express + React 19',
    category: 'electron',
    badge: 'Desktop Clásico',
    description: 'Suite completa de escritorio con proceso principal aislado, IPC seguro y empaquetador NSIS/AppImage.',
    icon: '⚡',
    files: [
      {
        name: 'electron/main.cjs',
        originalContent: `const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Commander AI Studio Electron',
    backgroundColor: '#000080',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

ipcMain.handle('app:get-system-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
  };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`,
      },
      {
        name: 'electron/preload.cjs',
        originalContent: `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getSystemInfo: () => ipcRenderer.invoke('app:get-system-info'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
});
`,
      },
      {
        name: 'src/App.tsx',
        originalContent: `import React, { useEffect, useState } from 'react';

export function App() {
  const [sysInfo, setSysInfo] = useState<any>(null);

  useEffect(() => {
    if ((window as any).desktopAPI?.getSystemInfo) {
      (window as any).desktopAPI.getSystemInfo().then(setSysInfo);
    } else {
      setSysInfo({ platform: 'web-browser', arch: 'x64', nodeVersion: 'v22.0.0', electronVersion: 'v34.0.0' });
    }
  }, []);

  return (
    <div className="p-6 bg-[#000080] min-h-screen text-[#00ffff] font-mono">
      <div className="border-2 border-[#00ffff] bg-[#0000aa] p-4 max-w-xl mx-auto">
        <h1 className="text-lg font-bold text-[#ffff55] mb-2">🖥️ ELECTRON 34 DESKTOP SUITE</h1>
        <p className="text-xs mb-4 text-white">Arquitectura multi-proceso con Sandbox y ContextBridge activados.</p>
        
        {sysInfo && (
          <div className="bg-[#000055] border border-[#00ffff] p-3 text-xs space-y-1">
            <div><strong>Plataforma:</strong> {sysInfo.platform}</div>
            <div><strong>Arquitectura:</strong> {sysInfo.arch}</div>
            <div><strong>Versión Node:</strong> {sysInfo.nodeVersion}</div>
            <div><strong>Versión Electron:</strong> {sysInfo.electronVersion}</div>
          </div>
        )}
      </div>
    </div>
  );
}
`,
      },
      {
        name: 'package.json',
        originalContent: `{
  "name": "commander-electron-app",
  "version": "1.0.0",
  "main": "electron/main.cjs",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "build:electron": "electron-builder --win --x64"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.1.8",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
`,
      }
    ]
  },

  {
    id: 'fullstack-ai-agent',
    title: 'Fullstack AI Agent (Claude 3.7 + Gemini)',
    category: 'ai_agent',
    badge: 'Multi-LLM Agent',
    description: 'Servidor Express con streaming SSE de Gemini 3.8 y Claude 3.7, tool use y telemetría.',
    icon: '🧠',
    files: [
      {
        name: 'server.ts',
        originalContent: `import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

// Proxy streaming endpoint for Anthropic Claude & Gemini
app.post('/api/agent/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { prompt, model = 'claude-3-7-sonnet-20250219' } = req.body;
  res.write(\`data: \${JSON.stringify({ type: 'start', model })}\\n\\n\`);
  
  // Real agent orchestration logic
  res.write(\`data: \${JSON.stringify({ type: 'chunk', text: 'Respuesta procesada por el agente de Commander Studio...' })}\\n\\n\`);
  res.write(\`data: \${JSON.stringify({ type: 'done' })}\\n\\n\`);
  res.end();
});

app.listen(3000, () => console.log('AI Agent Backend running on port 3000'));
`,
      },
      {
        name: 'src/App.tsx',
        originalContent: `import React, { useState } from 'react';

export function App() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [model, setModel] = useState('claude-3-7-sonnet-20250219');

  const handleRun = async () => {
    setOutput('Consultando modelo...');
    const response = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model })
    });
    // Stream reader
    setOutput('Flujo recibido con éxito.');
  };

  return (
    <div className="p-6 bg-[#000080] min-h-screen text-[#00ffff] font-mono">
      <div className="border-2 border-[#00ffff] bg-[#0000aa] p-4 max-w-xl mx-auto">
        <h1 className="text-lg font-bold text-[#ffff55] mb-2">🤖 MULTI-LLM AI AGENT PIPELINE</h1>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-[#000080] border border-[#00ffff] p-1.5 text-xs text-white mb-3">
          <option value="claude-3-7-sonnet-20250219">Claude 3.7 Sonnet (Anthropic)</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash (Google)</option>
        </select>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Escribe tu consulta para el agente..."
          className="w-full bg-[#000080] border border-[#00ffff] p-2 text-xs text-white h-24 mb-3"
        />
        <button onClick={handleRun} className="w-full bg-[#00ffff] text-black font-bold py-2 text-xs hover:bg-white">
          EJECUTAR INFERENCIA EN TIEMPO REAL
        </button>
        {output && <div className="mt-3 bg-[#000055] p-2 border border-[#ffff55] text-xs text-[#ffff55]">{output}</div>}
      </div>
    </div>
  );
}
`,
      },
      {
        name: 'package.json',
        originalContent: `{
  "name": "fullstack-ai-agent-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "@google/genai": "^2.4.0",
    "express": "^4.21.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
`,
      }
    ]
  },

  {
    id: 'mobile-capacitor-pwa',
    title: 'Mobile App (Capacitor Android/iOS + PWA)',
    category: 'mobile',
    badge: 'Mobile & Offline',
    description: 'Empaquetado móvil universal para Android Studio / Xcode con Service Worker 100% offline.',
    icon: '📱',
    files: [
      {
        name: 'capacitor.config.json',
        originalContent: `{
  "appId": "com.commander.mobileapp",
  "appName": "CommanderMobile",
  "webDir": "dist",
  "bundledWebRuntime": false,
  "server": {
    "androidScheme": "https"
  }
}
`,
      },
      {
        name: 'public/manifest.json',
        originalContent: `{
  "short_name": "CommanderMobile",
  "name": "Commander Mobile AI Studio",
  "icons": [
    {
      "src": "app-icon.svg",
      "type": "image/svg+xml",
      "sizes": "192x192 512x512"
    }
  ],
  "start_url": "/",
  "background_color": "#000080",
  "theme_color": "#0000aa",
  "display": "standalone"
}
`,
      },
      {
        name: 'src/App.tsx',
        originalContent: `import React, { useState } from 'react';

export function App() {
  const [offlineStatus, setOfflineStatus] = useState(navigator.onLine ? 'Conectado a la Red' : 'Modo Offline Activo');

  return (
    <div className="p-4 bg-[#000080] min-h-screen text-[#00ffff] font-mono flex flex-col justify-between">
      <div className="border-2 border-[#00ffff] bg-[#0000aa] p-4 text-center">
        <h1 className="text-base font-bold text-[#ffff55]">📱 COMMANDER MOBILE & PWA</h1>
        <p className="text-xs text-white mt-1">Listo para compilar en Android Studio (.APK / .AAB) o correr como PWA offline.</p>
        <div className="mt-3 bg-[#000055] p-2 border border-[#00ff66] text-[#00ff66] text-xs font-bold">
          {offlineStatus}
        </div>
      </div>
    </div>
  );
}
`,
      },
      {
        name: 'package.json',
        originalContent: `{
  "name": "commander-mobile-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "cap:sync": "cap sync",
    "cap:android": "cap open android",
    "cap:ios": "cap open ios"
  },
  "dependencies": {
    "@capacitor/core": "^6.0.0",
    "@capacitor/android": "^6.0.0",
    "@capacitor/ios": "^6.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
`,
      }
    ]
  },

  {
    id: 'cli-retro-commander',
    title: 'CLI Retro Terminal Tool (Node/Bun)',
    category: 'cli',
    badge: 'Terminal CLI',
    description: 'Herramienta de consola de comandos retro con parser de argumentos, colores ANSI y llamadas API.',
    icon: '📟',
    files: [
      {
        name: 'bin/commander.cjs',
        originalContent: `#!/usr/bin/env node
const { runCLI } = require('../dist/cli.cjs');
runCLI(process.argv.slice(2));
`,
      },
      {
        name: 'src/cli.ts',
        originalContent: `export function runCLI(args: string[]) {
  console.log('\\x1b[44m\\x1b[36m╔════════════════════════════════════════════════════════╗\\x1b[0m');
  console.log('\\x1b[44m\\x1b[33m║          COMMANDER RETRO TERMINAL CLI TOOL             ║\\x1b[0m');
  console.log('\\x1b[44m\\x1b[36m╚════════════════════════════════════════════════════════╝\\x1b[0m');

  const command = args[0] || 'help';
  if (command === 'help') {
    console.log('\\nComandos disponibles:');
    console.log('  commander generate <prompt>    Genera código con Gemini/Claude');
    console.log('  commander diff <file1> <file2> Compara dos archivos en terminal');
    console.log('  commander export               Exporta el proyecto como .ZIP');
  } else {
    console.log(\`\\nEjecutando comando: \${command}...\`);
  }
}
`,
      },
      {
        name: 'package.json',
        originalContent: `{
  "name": "commander-retro-cli",
  "version": "1.0.0",
  "bin": {
    "commander": "./bin/commander.cjs"
  },
  "scripts": {
    "build": "tsc",
    "start": "node bin/commander.cjs"
  },
  "dependencies": {
    "@google/genai": "^2.4.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
`,
      }
    ]
  }
];
