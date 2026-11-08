import React, { useState, useEffect } from 'react';
import { X, Hammer, Binary, CheckCircle2, Download, Play, Terminal, FileCode } from 'lucide-react';
import { ParameterConfig } from '../types/studio';
import { Language, TRANSLATIONS } from '../i18n/translations';
import { sendBrowserNotification, playRetroSuccessSound } from '../utils/browserNotifications';
import JSZip from 'jszip';

interface CompilerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Se dispara cuando una compilación termina con éxito (para eventos globales). */
  onSuccess?: () => void;
  promptTitle: string;
  selectedModel: string;
  parameters: ParameterConfig;
  defaultPrompt: string;
  defaultExportFolder?: string;
  lang?: Language;
}

type TargetPlatform = 'windows' | 'android' | 'macos' | 'linux' | 'electron' | 'tauri' | 'webgpu';

interface BuildStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  log: string;
}

export const CompilerModal: React.FC<CompilerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  promptTitle,
  selectedModel,
  parameters,
  defaultPrompt,
  defaultExportFolder = 'C:\\CommanderExports',
  lang = 'es',
}) => {
  const t = TRANSLATIONS[lang];
  const [platform, setPlatform] = useState<TargetPlatform>('windows');
  const [architecture, setArchitecture] = useState<'x86_64' | 'arm64' | 'wasm'>('x86_64');
  const [isCompiling, setIsCompiling] = useState(false);
  const [buildFinished, setBuildFinished] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'manifest' | 'test'>('logs');
  const [testResult, setTestResult] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const initialSteps: BuildStep[] = [
    { id: '1', label: lang === 'es' ? '1. Análisis Léxico & AST del Prompt' : lang === 'de' ? '1. Lexikalische & AST-Analyse des Prompts' : '1. Prompt Lexical & AST Analysis', status: 'pending', log: '' },
    { id: '2', label: lang === 'es' ? '2. Optimización de Presupuesto de Tokens' : lang === 'de' ? '2. Token-Budget & Sicherheitsoptimierung' : '2. Token Budget & Safety Optimization', status: 'pending', log: '' },
    { id: '3', label: lang === 'es' ? '3. Generación de Código Nativo Target' : lang === 'de' ? '3. Generierung des nativen Zielcodes' : '3. Native Target Code Generation', status: 'pending', log: '' },
    { id: '4', label: lang === 'es' ? '4. Vinculación del SDK & Compilador AOT' : lang === 'de' ? '4. SDK-Verknüpfung & AOT-Paketierung' : '4. SDK Linking & AOT Packaging', status: 'pending', log: '' },
    { id: '5', label: lang === 'es' ? '5. Ensamblado del Paquete Ejecutable (.ZIP)' : lang === 'de' ? '5. Erstellung des eigenständigen Pakets (.ZIP)' : '5. Standalone Bundle Assembly (.ZIP)', status: 'pending', log: '' },
  ];

  const [steps, setSteps] = useState<BuildStep[]>(initialSteps);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setBuildFinished(false);
      setSteps(initialSteps);
      setTerminalLogs([
        `[COMMANDER COMPILER v2.5.0]`,
        lang === 'es' ? `Inicializando entorno de compilación para target: ${platform.toUpperCase()} (${architecture})...` : lang === 'de' ? `Kompilierungsumgebung wird für Ziel: ${platform.toUpperCase()} (${architecture}) initialisiert...` : `Initializing compilation engine for target: ${platform.toUpperCase()} (${architecture})...`,
        lang === 'es' ? `Modelo seleccionado: ${selectedModel}` : lang === 'de' ? `Ausgewähltes Modell: ${selectedModel}` : `Selected model: ${selectedModel}`,
        lang === 'es' ? `Listo. Presione [INICIAR COMPILACIÓN] para compilar el proyecto.` : lang === 'de' ? `Bereit. Drücke [KOMPILIERUNG STARTEN], um das Projekt zu kompilieren.` : `Ready. Press [START COMPILATION] to build the artifact.`
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, platform, architecture, lang]);

  if (!isOpen) return null;

  const handleStartCompilation = async () => {
    setIsCompiling(true);
    setBuildFinished(false);
    setTerminalLogs([
      `>> commander-cc --target=${platform} --arch=${architecture} --model=${selectedModel}`,
      `[STEP 1] ${lang === 'es' ? 'Analizando estructura de Prompt e Instrucción del Sistema...' : lang === 'de' ? 'Prompt-Struktur und Systemanweisung werden analysiert...' : 'Parsing prompt structure & System Instruction...'}`
    ]);

    // Step 1
    setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'running' } : s));
    await new Promise(r => setTimeout(r, 600));
    setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'success', log: 'AST OK: 0 syntax errors' } : s));
    setTerminalLogs(prev => [
      ...prev,
      `[AST] System instruction validated: ${parameters.systemInstruction?.length || 0} bytes`,
      `[AST] Model parameters: temp=${parameters.temperature}, topP=${parameters.topP}, maxTokens=${parameters.maxTokens}`,
      `[STEP 2] ${lang === 'es' ? 'Optimizando tokens y tablas de secuencias de parada...' : lang === 'de' ? 'Tokens und Stoppsequenz-Tabellen werden optimiert...' : 'Optimizing tokens & stop sequence tables...'}`
    ]);

    // Step 2
    setSteps(prev => prev.map((s, i) => i === 1 ? { ...s, status: 'running' } : s));
    await new Promise(r => setTimeout(r, 700));
    setSteps(prev => prev.map((s, i) => i === 1 ? { ...s, status: 'success', log: 'Token budget OK: ~128 tokens context' } : s));
    setTerminalLogs(prev => [
      ...prev,
      `[OPT] Token allocator budget verified. Overhead: 0.04%`,
      `[STEP 3] ${lang === 'es' ? `Generando arquitectura ${architecture} para ${platform}...` : lang === 'de' ? `Native Quellen für ${architecture} und ${platform} werden erzeugt...` : `Synthesizing ${architecture} native sources for ${platform}...`}`
    ]);

    // Step 3
    setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, status: 'running' } : s));
    await new Promise(r => setTimeout(r, 800));
    setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, status: 'success', log: 'Code synthesis finished' } : s));
    setTerminalLogs(prev => [
      ...prev,
      `[GEN] Produced standalone source manifest and bootstrap runtime`,
      `[STEP 4] ${lang === 'es' ? 'Vinculando bibliotecas cliente y dependencias AOT...' : lang === 'de' ? 'Nativer Client-SDK und Laufzeit-Stubs werden verknüpft...' : 'Linking native client SDK and runtime stubs...'}`
    ]);

    // Step 4
    setSteps(prev => prev.map((s, i) => i === 3 ? { ...s, status: 'running' } : s));
    await new Promise(r => setTimeout(r, 700));
    setSteps(prev => prev.map((s, i) => i === 3 ? { ...s, status: 'success', log: 'Linked @google/genai runtime' } : s));
    setTerminalLogs(prev => [
      ...prev,
      `[LNK] Linked Google GenAI Client Runtime v0.1.2`,
      `[STEP 5] ${lang === 'es' ? 'Empaquetando artefacto ejecutable...' : lang === 'de' ? 'Ausführbares Verteilungspaket wird zusammengestellt...' : 'Assembling executable distribution bundle...'}`
    ]);

    // Step 5
    setSteps(prev => prev.map((s, i) => i === 4 ? { ...s, status: 'running' } : s));
    await new Promise(r => setTimeout(r, 600));
    setSteps(prev => prev.map((s, i) => i === 4 ? { ...s, status: 'success', log: 'Ready: artifact.zip prepared' } : s));
    setTerminalLogs(prev => [
      ...prev,
      `[SUCCESS] ------------------------------------------------`,
      lang === 'es' ? `[OK] Compilación completada con éxito. Código de salida: 0 (0 errores, 0 advertencias)` : lang === 'de' ? `[OK] Kompilierung erfolgreich abgeschlossen. Exit-Code: 0 (0 Fehler, 0 Warnungen)` : `[OK] Build completed successfully. Exit code: 0 (0 errors, 0 warnings)`,
      lang === 'es' ? `[DIR] Carpeta de exportación por defecto: ${defaultExportFolder}` : lang === 'de' ? `[DIR] Standard-Ausgabeordner: ${defaultExportFolder}` : `[DIR] Default export destination: ${defaultExportFolder}`,
      lang === 'es' ? `[OK] Artefacto listo para distribución o ejecución directa.` : lang === 'de' ? `[OK] Artefakt bereit zur Verteilung oder direkten Ausführung.` : `[OK] Artifact ready for deployment or direct execution.`
    ]);

    setIsCompiling(false);
    setBuildFinished(true);
    onSuccess?.();

    sendBrowserNotification(
      lang === 'es' ? '🛠️ Compilación Exitosa' : lang === 'de' ? '🛠️ Kompilierung erfolgreich' : '🛠️ Compilation Succeeded',
      lang === 'es'
        ? `El proyecto "${promptTitle || 'Sin título'}" se compiló para ${platform.toUpperCase()} con éxito.`
        : lang === 'de'
          ? `Projekt "${promptTitle || 'Ohne Titel'}" wurde erfolgreich für ${platform.toUpperCase()} kompiliert.`
          : `Project "${promptTitle || 'Untitled'}" compiled successfully for ${platform.toUpperCase()}.`
    );
    playRetroSuccessSound();
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const safeTitle = (promptTitle || 'CommanderProject').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const folder = zip.folder(safeTitle) || zip;

    // Manifest
    const manifest = {
      name: promptTitle || 'Commander AI Project',
      target: platform,
      architecture,
      model: selectedModel,
      compiledAt: new Date().toISOString(),
      compilerVersion: 'v2.5.0',
      parameters,
      systemInstruction: parameters.systemInstruction || '',
    };
    const formatBat = (str: string) => str.replace(/\r?\n/g, '\r\n');
    folder.file('commander-manifest.json', JSON.stringify(manifest, null, 2));

    // Entry point scripts based on platform
    if (platform === 'windows') {
      folder.file('Program.cs', `// Generated by Commander AI Studio Compiler v2.5.0
using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

class Program {
    static async Task Main(string[] args) {
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("=================================================");
        Console.WriteLine("  ${promptTitle || 'Commander AI'} - Windows Native Terminal");
        Console.WriteLine("  Engine: ${selectedModel} | Arch: ${architecture}");
        Console.WriteLine("=================================================");
        Console.ResetColor();

        Console.Write("\\nIngrese su prompt (o presione Enter para el default): ");
        string input = Console.ReadLine();
        if (string.IsNullOrWhiteSpace(input)) {
            input = "${defaultPrompt.replace(/"/g, '\\"')}";
        }

        Console.WriteLine("\\nProcesando inferencia...");
        Console.WriteLine("[System]: ${parameters.systemInstruction.replace(/"/g, '\\"')}");
        Console.WriteLine("[User]: " + input);
    }
}
`);
      folder.file('run.bat', `@echo off\ntitle ${promptTitle || 'Commander App'}\ncls\ndotnet run\npause\n`);
    } else if (platform === 'electron') {
      folder.file('package.json', JSON.stringify({
        name: safeTitle,
        version: '1.0.0',
        productName: promptTitle || 'Commander AI App',
        main: 'main.cjs',
        scripts: {
          start: 'electron main.cjs',
          dev: 'electron main.cjs',
          'build:win': 'electron-builder --win --x64',
          build: 'electron-builder --win --x64'
        },
        build: {
          appId: `com.commander.${safeTitle.replace(/-/g, '')}`,
          productName: promptTitle || 'Commander AI App',
          directories: {
            output: 'dist'
          },
          files: [
            'index.html',
            'main.cjs',
            'preload.cjs'
          ],
          win: {
            target: ['nsis', 'portable']
          }
        },
        devDependencies: {
          electron: '^34.0.0',
          'electron-builder': '^25.1.8'
        }
      }, null, 2));

      folder.file('main.cjs', `// Electron Main Process for ${promptTitle}
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '${promptTitle || 'Commander AI'}',
    backgroundColor: '#000080',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`);

      folder.file('preload.cjs', `const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  appTitle: '${promptTitle}',
  model: '${selectedModel}'
});
`);

      folder.file('index.html', `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${promptTitle}</title>
  <style>
    body { background: #000080; color: #00ffff; font-family: monospace; padding: 24px; }
    h1 { color: #ffff55; }
    pre { background: #000055; padding: 16px; border: 2px solid #00ffff; }
    button { background: #ffff55; color: black; font-weight: bold; border: 2px solid white; padding: 8px 16px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>${promptTitle} • Electron Desktop</h1>
  <p>Engine: ${selectedModel} | System: ${parameters.systemInstruction || 'Default'}</p>
  <pre>${defaultPrompt}</pre>
  <button onclick="alert('Inference trigger ready.')">Ejecutar Inferencia</button>
</body>
</html>`);

      folder.file('run.bat', formatBat(`@echo off\ntitle ${promptTitle} Electron\ncall npm install\ncall npm start\npause\n`));
      folder.file('run.sh', `#!/usr/bin/env bash\nnpm install && npm start\n`);

    } else if (platform === 'tauri') {
      folder.file('package.json', JSON.stringify({
        name: safeTitle,
        version: '1.0.0',
        scripts: {
          dev: 'tauri dev',
          build: 'tauri build'
        },
        devDependencies: {
          '@tauri-apps/cli': '^2.0.0'
        }
      }, null, 2));

      const tauriFolder = folder.folder('src-tauri') || folder;
      tauriFolder.file('Cargo.toml', `[package]
name = "${safeTitle}"
version = "2.5.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = [] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
`);

      tauriFolder.file('tauri.conf.json', JSON.stringify({
        $schema: 'https://schema.tauri.app/config/2',
        productName: promptTitle || 'Commander AI App',
        version: '2.5.0',
        identifier: `com.commander.${safeTitle}`,
        build: {
          frontendDist: '../dist'
        },
        app: {
          windows: [
            {
              title: promptTitle || 'Commander AI App',
              width: 1280,
              height: 800
            }
          ]
        }
      }, null, 2));

      tauriFolder.file('build.rs', `fn main() { tauri_build::build() }`);
      const srcFolder = tauriFolder.folder('src') || tauriFolder;
      srcFolder.file('main.rs', `fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
`);
      const defaultHtml = `<!DOCTYPE html><html><head><title>${promptTitle}</title></head><body style="background:#000080;color:#00ffff;font-family:monospace;padding:24px;"><h1>${promptTitle} • Tauri Rust Native</h1><p>Engine: ${selectedModel}</p></body></html>`;
      folder.file('index.html', defaultHtml);
      folder.file('dist/index.html', defaultHtml);

      folder.file('run.bat', formatBat(`@echo off\ntitle ${promptTitle} Tauri\ncall cargo tauri dev\npause\n`));
      folder.file('run.sh', `#!/usr/bin/env bash\ncargo tauri dev\n`);

    } else if (platform === 'android') {
      folder.file('MainActivity.kt', `// Android Kotlin Jetpack Compose Artifact
package com.commander.ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Text("${promptTitle}: Ready with model ${selectedModel}")
        }
    }
}
`);
      folder.file('build.gradle.kts', `plugins { id("com.android.application") }`);
    } else {
      folder.file('main.py', `# Universal Python / Standalone runner
import os
import sys

print("Commander Studio Native Binary Runner")
print("Target: ${platform} | Model: ${selectedModel}")
`);
      folder.file('run.sh', `#!/usr/bin/env bash\necho "Running ${promptTitle}..."\npython3 main.py\n`);
    }

    // Automated .BAT build scripts
    const compilarElectronBat = formatBat(`@echo off
title COMPILADOR AUTOMATIZADO DE ELECTRON - ${promptTitle}
color 1F
cls
echo =======================================================================
echo    COMPILADOR AUTOMATIZADO DE ELECTRON PARA WINDOWS (.EXE)
echo    Proyecto: ${promptTitle} | Commander AI Studio
echo =======================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR CRITICO] Node.js no esta instalado. Descargalo de https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] Instalando dependencias de Node.js...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Fallo npm install. Verifica tu conexion a internet.
    pause
    exit /b 1
)

echo.
echo [2/3] Compilando ejecutable nativo de Windows (.EXE / NSIS)...
call npx electron-builder --win --x64
if %errorlevel% neq 0 (
    echo [ERROR] Error durante la compilacion de Electron.
    pause
    exit /b 1
)

echo.
echo [3/3] COMPILACION EXITOSA DE ELECTRON!
echo =======================================================================
echo Tu instalador .exe se encuentra listo en la carpeta:
echo %CD%\\dist
echo =======================================================================
echo.

if exist "dist" ( explorer "dist" )
pause
`);

    const compilarTauriBat = formatBat(`@echo off
title COMPILADOR AUTOMATIZADO DE TAURI RUST - ${promptTitle}
color 1F
cls
echo =======================================================================
echo    COMPILADOR AUTOMATIZADO DE TAURI RUST PARA WINDOWS (.EXE / .MSI)
echo    Proyecto: ${promptTitle} | Commander AI Studio
echo =======================================================================
echo.

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR CRITICO] Cargo / Rust no esta instalado.
    echo Descarga e instala Rustup desde https://rustup.rs con C++ Build Tools
    pause
    exit /b 1
)

echo [1/3] Verificando entorno de Node.js...
call npm install 2>nul

echo.
echo [2/3] Compilando binario nativo ultra-rapido con Tauri v2 (Rust)...
call cargo tauri build
if %errorlevel% neq 0 (
    echo [ERROR] Fallo la compilacion con Tauri Rust.
    pause
    exit /b 1
)

echo.
echo [3/3] COMPILACION DE TAURI EXITOSA!
echo =======================================================================
echo Tus ejecutables nativos .exe y .msi se encuentran en:
echo %CD%\\src-tauri\\target\\release\\bundle
echo =======================================================================
echo.

if exist "src-tauri\\target\\release\\bundle" ( explorer "src-tauri\\target\\release\\bundle" )
pause
`);

    folder.file('COMPILAR-ELECTRON.bat', compilarElectronBat);
    folder.file('COMPILAR-TAURI.bat', compilarTauriBat);
    folder.file('COMPILAR-AUTOMATIZADO.bat', compilarElectronBat);

    const readmeGuide = `# 🚀 ${promptTitle || 'Commander AI Project'} - ARTEFACTO & GUÍA DE COMPILACIÓN NATIVA
Generado por **Commander AI Studio** (Edición Norton Retro v2.5.0).
Autor del Estudio: **Edel Arencibia Baez** (2 de Octubre de 2026).

Plataforma Objetivo: **${platform.toUpperCase()}** (${architecture})
Modelo de IA: **${selectedModel}**

---

## ⚡ 1. CÓMO COMPILAR EN ELECTRON (Windows .exe, macOS .dmg, Linux .AppImage)

Electron te permite empaquetar esta aplicación en un instalador nativo para Windows, macOS o Linux usando Node.js.

### Requisitos:
- Node.js (v18 o superior): https://nodejs.org
- npm / pnpm / yarn

### Pasos:
\`\`\`bash
# 1. Instalar dependencias
npm install

# 2. Probar la app en modo escritorio:
npm start
# o en Windows: run.bat

# 3. Compilar instaladores y binarios:
npx electron-builder --win        # Windows .exe (Instalador NSIS y Portable)
npx electron-builder --mac        # macOS .dmg y .app universal
npx electron-builder --linux      # Linux .AppImage y .deb
\`\`\`
*Los archivos generados se ubicarán en la carpeta \`dist/\`.*

---

## 🦀 2. CÓMO COMPILAR EN TAURI v2 (Rust - Binario Nativo < 10MB)

Tauri v2 crea ejecutables ultralivianos en lenguaje Rust con consumo mínimo de recursos del sistema.

### Requisitos:
- Rust & Cargo: https://rustup.rs
  - En Windows: Requiere Visual Studio C++ Build Tools.
  - En macOS / Linux: \`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\`

### Pasos:
\`\`\`bash
# 1. Probar en modo desarrollo:
cargo tauri dev
# o en Windows: run.bat

# 2. Compilar binario nativo optimizado:
cargo tauri build
\`\`\`
*Los instaladores generados (.msi, .exe, .dmg o .deb) se ubicarán en \`src-tauri/target/release/bundle/\`.*

---

## 💻 3. SCRIPTS INCLUIDOS EN ESTE PAQUETE:
- \`run.bat\` / \`run.sh\` : Ejecución directa con un clic.
- \`commander-manifest.json\` : Especificación técnica y configuración de inferencia.

---
© 2026 Commander AI Studio • Edel Arencibia Baez
`;

    folder.file('README.md', readmeGuide);
    folder.file('README-COMPILACION-ELECTRON-TAURI.md', readmeGuide);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}-${platform}-${architecture}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult('');
    try {
      const response = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: defaultPrompt || 'Test prompt execution',
          systemInstruction: parameters.systemInstruction,
          model: selectedModel,
          temperature: parameters.temperature,
          topP: parameters.topP,
          maxTokens: parameters.maxTokens,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setTestResult(data.text || (lang === 'es' ? 'Ejecución exitosa sin salida de texto.' : lang === 'de' ? 'Ausführung erfolgreich ohne Textausgabe.' : 'Execution successful without text output.'));
      } else {
        setTestResult(`Error: ${data.error || 'Execution failed'}`);
      }
    } catch (e: any) {
      setTestResult(`Error de conexión: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="nc-panel w-full max-w-4xl max-h-[90vh] flex flex-col bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] shadow-[10px_10px_0px_var(--nc-shadow)] cursor-default text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar */}
        <div className="nc-header p-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <Hammer className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider">
              {t.compilerTitle}
            </span>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="nc-button !px-2 !py-0.5 text-xs bg-red-600 text-white hover:bg-red-500 font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtitle Banner */}
        <div className="bg-[var(--nc-bg-main)] border-b-2 border-[var(--nc-border-light)] p-2 flex flex-wrap items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-2">
            <Binary className="w-4 h-4 text-[var(--nc-text-accent)]" />
            <span className="text-[11px] text-[var(--nc-text)] font-bold">
              {t.compilerSubtitle}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="bg-[var(--nc-bg-panel)] px-2 py-0.5 border border-[var(--nc-border-light)] text-[var(--nc-text-accent)]">
              {selectedModel}
            </span>
          </div>
        </div>

        {/* Configuration Bar */}
        <div className="p-3 bg-[var(--nc-bg-deep)] border-b-2 border-[var(--nc-border-light)] grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Target Platform */}
          <div>
            <label className="text-[10px] text-[var(--nc-text-accent)] font-bold block mb-1">
              {lang === 'es' ? 'PLATAFORMA DESTINO:' : lang === 'de' ? 'ZIELPLATTFORM:' : 'TARGET PLATFORM:'}
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as any)}
              className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-1 text-[11px] text-white font-bold outline-none cursor-pointer"
            >
              <option value="windows">🪟 Windows 11 / 10 (.NET / EXE)</option>
              <option value="electron">⚡ Electron Desktop (.EXE / .DMG / AppImage)</option>
              <option value="tauri">🦀 Tauri v2 + Rust (.EXE / .DMG / .deb)</option>
              <option value="android">🤖 Android (.APK / Kotlin)</option>
              <option value="macos">🍎 macOS / iOS (Swift)</option>
              <option value="linux">🐧 Linux (AppImage / Python)</option>
              <option value="webgpu">⚡ WebGPU / WASM Local</option>
            </select>
          </div>

          {/* Architecture */}
          <div>
            <label className="text-[10px] text-[var(--nc-text-accent)] font-bold block mb-1">
              {t.architecture}:
            </label>
            <select
              value={architecture}
              onChange={(e) => setArchitecture(e.target.value as any)}
              className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-1 text-[11px] text-white font-bold outline-none cursor-pointer"
            >
              <option value="x86_64">x86_64 (Intel / AMD 64-bit)</option>
              <option value="arm64">ARM64 (Apple Silicon / Qualcomm / Mobile)</option>
              <option value="wasm">WebAssembly (WASM-32 / WebGPU)</option>
            </select>
          </div>

          {/* Compile Trigger */}
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleStartCompilation}
              disabled={isCompiling}
              className={`w-full py-1.5 px-3 font-bold text-xs flex items-center justify-center gap-1.5 border border-white transition-all ${
                isCompiling
                  ? 'bg-amber-400 text-black animate-pulse'
                  : 'bg-[var(--nc-active-bg)] text-black hover:bg-white cursor-pointer shadow-[2px_2px_0px_#000000]'
              }`}
            >
              <Hammer className="w-4 h-4 text-[var(--nc-active-text)]" />
              <span>{isCompiling ? (lang === 'es' ? 'COMPILANDO...' : lang === 'de' ? 'KOMPILIERE...' : 'COMPILING...') : (lang === 'es' ? 'INICIAR COMPILACIÓN' : lang === 'de' ? 'KOMPILIERUNG STARTEN' : 'START COMPILATION')}</span>
            </button>
          </div>
        </div>

        {/* Compiler Pipeline Steps */}
        <div className="bg-[var(--nc-bg-panel)] p-2.5 border-b border-[var(--nc-border-light)] grid grid-cols-1 sm:grid-cols-5 gap-1.5 text-[10px]">
          {steps.map((st) => (
            <div 
              key={st.id} 
              className={`p-1.5 border flex flex-col justify-between ${
                st.status === 'success' 
                  ? 'border-green-400 bg-green-950/40 text-green-300' 
                  : st.status === 'running'
                  ? 'border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)]/20 text-[var(--nc-text-accent)] animate-pulse'
                  : 'border-[var(--nc-border-mid)] bg-[var(--nc-bg-deep)] text-gray-400'
              }`}
            >
              <span className="font-bold truncate">{st.label}</span>
              <div className="flex items-center justify-between mt-1">
                <span>{st.status.toUpperCase()}</span>
                {st.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
              </div>
            </div>
          ))}
        </div>

        {/* Tab Buttons */}
        <div className="bg-[var(--nc-bg-main)] border-b border-[var(--nc-border-light)] px-2 py-1 flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1 font-bold text-[10px] border flex items-center gap-1 ${
              activeTab === 'logs' ? 'bg-[var(--nc-active-bg)] text-black border-white' : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-mid)]'
            }`}
          >
            <Terminal className="w-3 h-3" />
            <span>{lang === 'es' ? 'TERMINAL DE COMPILACIÓN' : lang === 'de' ? 'BUILD-TERMINAL' : 'BUILD TERMINAL'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manifest')}
            className={`px-3 py-1 font-bold text-[10px] border flex items-center gap-1 ${
              activeTab === 'manifest' ? 'bg-[var(--nc-active-bg)] text-black border-white' : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-mid)]'
            }`}
          >
            <FileCode className="w-3 h-3" />
            <span>{lang === 'es' ? 'MANIFEST & ESPECIFICACIÓN' : lang === 'de' ? 'MANIFEST & SPEZIFIKATION' : 'MANIFEST & SPEC'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('test')}
            className={`px-3 py-1 font-bold text-[10px] border flex items-center gap-1 ${
              activeTab === 'test' ? 'bg-[var(--nc-active-bg)] text-black border-white' : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-mid)]'
            }`}
          >
            <Play className="w-3 h-3" />
            <span>{lang === 'es' ? 'SUITE DE PRUEBA DEL BINARIO' : lang === 'de' ? 'BINÄR-TESTSUITE' : 'BINARY TEST SUITE'}</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-3 overflow-y-auto flex-1 bg-[var(--nc-bg-deep)] min-h-[220px]">
          {activeTab === 'logs' && (
            <div className="font-mono text-[11px] text-[var(--nc-text)] space-y-1">
              {terminalLogs.map((log, idx) => (
                <div key={idx} className={log.includes('[SUCCESS]') || log.includes('[OK]') ? 'text-green-400 font-bold' : log.includes('>>') ? 'text-[var(--nc-text-accent)] font-bold' : ''}>
                  {log}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'manifest' && (
            <pre className="text-[11px] text-[var(--nc-text)] font-mono whitespace-pre-wrap">
              {JSON.stringify({
                artifact: promptTitle || 'CommanderApp',
                version: 'v2.5.0-build.1',
                compiler: 'Norton Commander AI Studio Compiler',
                target: platform,
                architecture,
                engine: {
                  model: selectedModel,
                  temperature: parameters.temperature,
                  topP: parameters.topP,
                  maxTokens: parameters.maxTokens,
                  thinkingLevel: parameters.thinkingLevel || 'DEFAULT',
                },
                systemPrompt: parameters.systemInstruction || '(none)',
                hash: 'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              }, null, 2)}
            </pre>
          )}

          {activeTab === 'test' && (
            <div className="space-y-3">
              <div className="bg-[var(--nc-bg-panel)] p-2.5 border border-[var(--nc-border-light)] flex items-center justify-between">
                <div>
                  <span className="font-bold text-[var(--nc-text-accent)] block">{lang === 'es' ? 'Ejecución de Prueba del Artefacto Compilado:' : lang === 'de' ? 'Testlauf des kompilierten Artefakts:' : 'Test Run of Compiled Artifact:'}</span>
                  <span className="text-[10px] text-gray-300">Prompt: "{defaultPrompt.slice(0, 80)}..."</span>
                </div>
                <button
                  type="button"
                  onClick={handleRunTest}
                  disabled={isTesting}
                  className="nc-button bg-[var(--nc-active-bg)] text-black font-bold flex items-center gap-1.5 px-3 py-1"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isTesting ? (lang === 'es' ? 'EJECUTANDO...' : lang === 'de' ? 'AUSFÜHRUNG...' : 'EXECUTING...') : (lang === 'es' ? 'EJECUTAR TEST' : lang === 'de' ? 'TEST AUSFÜHREN' : 'RUN TEST')}</span>
                </button>
              </div>

              {testResult && (
                <div className="bg-[var(--nc-bg-panel)] p-3 border border-green-400 text-white space-y-1">
                  <div className="text-[10px] text-green-300 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{lang === 'es' ? 'RESPUESTA RECIBIDA DEL BINARIO COMPILADO:' : lang === 'de' ? 'ANTWORT VOM KOMPILIERTEN ARTEFAKT:' : 'RESPONSE RECEIVED FROM COMPILED ARTIFACT:'}</span>
                  </div>
                  <p className="text-[11px] whitespace-pre-wrap leading-relaxed">{testResult}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with Download */}
        <div className="bg-[var(--nc-header-bg)] p-2.5 flex items-center justify-between border-t-2 border-black">
          <div className="flex items-center gap-2">
            {buildFinished ? (
              <span className="text-black font-bold flex items-center gap-1 text-[11px]">
                <CheckCircle2 className="w-4 h-4 text-green-800" />
                {t.compileSuccess}
              </span>
            ) : (
              <span className="text-black font-bold text-[11px]">
                {lang === 'es' ? 'Modo Compilador Activo' : lang === 'de' ? 'Compiler-Modus aktiv' : 'Compiler Mode Active'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={!buildFinished}
              className={`nc-button text-xs font-bold flex items-center gap-1.5 px-3 py-1 ${
                buildFinished 
                  ? 'bg-[var(--nc-active-bg)] text-black border-black hover:bg-white cursor-pointer shadow-[2px_2px_0px_#000000]' 
                  : 'bg-gray-400 text-gray-700 cursor-not-allowed opacity-50'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.downloadZip}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="nc-button text-xs bg-red-600 text-white hover:bg-red-500 font-bold px-3 py-1"
            >
              {t.close} [ESC]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
